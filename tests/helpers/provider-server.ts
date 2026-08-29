import { createServer, type Server } from "node:http";

export interface SimulatedResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  delayMs?: number;
}

export type ProviderSimulatorMode = "success" | "quota";

export interface ProviderSimulatorCall {
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export class ProviderSimulator {
  readonly calls: ProviderSimulatorCall[] = [];
  private readonly responses: SimulatedResponse[] = [];
  private readonly countWaiters: Array<{ count: number; resolve: () => void }> = [];
  private server: Server | null = null;
  private mode: ProviderSimulatorMode = "success";
  private expectedBearer: string | null = null;
  private requestGate: Promise<void> = Promise.resolve();
  private releaseGate: (() => void) | null = null;
  url = "";

  get requestCount(): number {
    return this.calls.length;
  }

  enqueue(response: SimulatedResponse): void {
    this.responses.push(response);
  }

  setMode(mode: ProviderSimulatorMode): void {
    this.mode = mode;
  }

  requireBearer(token: string | null): void {
    this.expectedBearer = token;
  }

  blockRequests(): void {
    if (this.releaseGate) return;
    this.requestGate = new Promise<void>((resolve) => {
      this.releaseGate = resolve;
    });
  }

  releaseRequests(): void {
    const release = this.releaseGate;
    this.releaseGate = null;
    this.requestGate = Promise.resolve();
    release?.();
  }

  async waitForRequestCount(count: number): Promise<void> {
    if (this.requestCount >= count) return;
    await new Promise<void>((resolve) => this.countWaiters.push({ count, resolve }));
  }

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        this.calls.push({
          path: request.url ?? "/",
          method: request.method ?? "GET",
          headers: { ...request.headers },
          body: Buffer.concat(chunks).toString("utf8"),
        });
        this.resolveCountWaiters();
        const gate = this.requestGate;
        void gate.then(() => {
          const authorized =
            this.expectedBearer === null ||
            request.headers.authorization === `Bearer ${this.expectedBearer}`;
          const next = authorized
            ? (this.responses.shift() ?? this.responseForMode(request.url ?? "/"))
            : { status: 401, body: { error: { code: "invalid_api_key" } } };
          setTimeout(() => {
            response.writeHead(next.status, {
              "Content-Type": "application/json",
              ...next.headers,
            });
            response.end(
              typeof next.body === "string" ? next.body : JSON.stringify(next.body ?? {}),
            );
          }, next.delayMs ?? 0);
        });
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("SIMULATOR_START_FAILED");
    this.url = `http://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    if (!this.server) return;
    this.releaseRequests();
    if (!this.server.listening) {
      this.server = null;
      return;
    }
    await new Promise<void>((resolve, reject) =>
      this.server!.close((error) => (error ? reject(error) : resolve())),
    );
    this.server = null;
  }

  private responseForMode(path: string): SimulatedResponse {
    if (this.mode === "quota") {
      return {
        status: 429,
        body: { error: { code: "insufficient_quota", message: "quota exceeded" } },
      };
    }
    if (path.endsWith("/models"))
      return { status: 200, body: { data: [{ id: "model-a" }, { id: "model-b" }] } };
    if (path.endsWith("/api/tags"))
      return { status: 200, body: { models: [{ model: "llama-a" }, { name: "llama-b" }] } };
    if (path.endsWith("/chat/completions"))
      return {
        status: 200,
        body: {
          choices: [
            {
              finish_reason: "stop",
              message: { content: '{"translations":[{"id":"probe","text":"hola"}]}' },
            },
          ],
        },
      };
    return { status: 200, body: {} };
  }

  private resolveCountWaiters(): void {
    for (let index = this.countWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.countWaiters[index];
      if (waiter && this.requestCount >= waiter.count) {
        this.countWaiters.splice(index, 1);
        waiter.resolve();
      }
    }
  }
}
