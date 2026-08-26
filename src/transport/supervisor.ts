import { SubTandemError } from "../domain/errors.js";
import type { TransportRequest, TransportResponse, TransportRpcClient } from "./client.js";

function isExpiredSession(error: unknown): boolean {
  return error instanceof SubTandemError && error.code === "HELPER_UNAVAILABLE";
}

/**
 * Owns the replaceable native-helper session for the Global entry.
 *
 * Every upstream request is preceded by a side-effect-free loopback health
 * call. An expired idle helper can therefore be replaced before any provider
 * body is dispatched. A provider request that fails after dispatch is never
 * replayed here; the player-owned retry policy remains authoritative.
 */
export class TransportSupervisor implements TransportRpcClient {
  private client: TransportRpcClient | null = null;
  private starting: Promise<TransportRpcClient> | null = null;
  private checking: Promise<TransportRpcClient> | null = null;

  constructor(private readonly start: () => Promise<TransportRpcClient>) {}

  private async currentOrStart(): Promise<TransportRpcClient> {
    if (this.client) return this.client;
    if (!this.starting) {
      const starting = this.start();
      this.starting = starting;
      void starting.then(
        (client) => {
          if (this.starting === starting) {
            this.client = client;
            this.starting = null;
          }
        },
        () => {
          if (this.starting === starting) this.starting = null;
        },
      );
    }
    return this.starting;
  }

  private invalidate(client: TransportRpcClient): void {
    if (this.client !== client) return;
    this.client = null;
    // A loopback failure may leave the native process alive even though its
    // session is no longer usable. Retire it best-effort before replacement so
    // repeated failures cannot accumulate orphan listeners under IINA.
    void client.shutdown().catch(() => undefined);
  }

  private async liveClient(): Promise<TransportRpcClient> {
    if (this.checking) return this.checking;
    const checking = (async () => {
      let client = await this.currentOrStart();
      try {
        await client.health();
        return client;
      } catch (error) {
        if (!isExpiredSession(error)) throw error;
        this.invalidate(client);
      }

      client = await this.currentOrStart();
      try {
        await client.health();
        return client;
      } catch (error) {
        this.invalidate(client);
        throw error;
      }
    })();
    this.checking = checking;
    try {
      return await checking;
    } finally {
      if (this.checking === checking) this.checking = null;
    }
  }

  async health(): Promise<void> {
    let client = await this.liveClient();
    try {
      return await client.health();
    } catch (error) {
      if (!isExpiredSession(error)) throw error;
      this.invalidate(client);
    }
    client = await this.liveClient();
    await client.health();
  }

  async credentialRead(profileId: string): Promise<Record<string, string> | null> {
    let client = await this.liveClient();
    try {
      return await client.credentialRead(profileId);
    } catch (error) {
      if (!isExpiredSession(error)) throw error;
      this.invalidate(client);
    }
    client = await this.liveClient();
    return client.credentialRead(profileId);
  }

  async credentialWrite(profileId: string, fields: Record<string, string>): Promise<void> {
    let client = await this.liveClient();
    try {
      await client.credentialWrite(profileId, fields);
      return;
    } catch (error) {
      if (!isExpiredSession(error)) throw error;
      this.invalidate(client);
    }
    // Replacing all fields for one profile is idempotent, so a lost helper
    // response may safely repeat the exact write on a replacement session.
    client = await this.liveClient();
    await client.credentialWrite(profileId, fields);
  }

  async credentialDelete(profileId: string): Promise<void> {
    let client = await this.liveClient();
    try {
      await client.credentialDelete(profileId);
      return;
    } catch (error) {
      if (!isExpiredSession(error)) throw error;
      this.invalidate(client);
    }
    client = await this.liveClient();
    await client.credentialDelete(profileId);
  }

  async request(request: TransportRequest): Promise<TransportResponse> {
    const client = await this.liveClient();
    try {
      return await client.request(request);
    } catch (error) {
      if (isExpiredSession(error)) this.invalidate(client);
      throw error;
    }
  }

  async cancel(jobId: string): Promise<"cancelled" | "already-completed" | "unknown"> {
    let client = this.client;
    if (!client && this.starting) {
      try {
        client = await this.starting;
      } catch {
        return "unknown";
      }
    }
    if (!client) return "unknown";
    try {
      return await client.cancel(jobId);
    } catch (error) {
      if (!isExpiredSession(error)) throw error;
      this.invalidate(client);
      return "unknown";
    }
  }

  async shutdown(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.checking = null;
    if (!client) return;
    try {
      await client.shutdown();
    } catch (error) {
      if (!isExpiredSession(error)) throw error;
    }
  }
}
