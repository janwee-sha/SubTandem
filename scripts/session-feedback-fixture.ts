import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const scenarios = ["authentication", "configuration", "network", "model", "quota"] as const;

function collectBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.once("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function translationIds(body: string): string[] {
  const strings = [body];
  try {
    const visit = (value: unknown): void => {
      if (typeof value === "string") {
        strings.push(value);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (value && typeof value === "object") Object.values(value).forEach(visit);
    };
    visit(JSON.parse(body));
  } catch {
    return [];
  }
  return [
    ...new Set(
      strings.flatMap((value) =>
        [...value.matchAll(/"id"\s*:\s*"([^"]+)"/g)].map((match) => match[1]!),
      ),
    ),
  ].filter((value) => value !== "string");
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function failure(response: ServerResponse, scenario: (typeof scenarios)[number]): void {
  if (scenario === "authentication") {
    json(response, 401, { error: { code: "invalid_api_key", message: "Authentication failed" } });
    return;
  }
  if (scenario === "configuration") {
    json(response, 400, {
      error: {
        code: "unsupported_response_format",
        message: "The requested response format is not supported",
      },
    });
    return;
  }
  if (scenario === "model") {
    json(response, 404, { error: { code: "model_not_found", message: "Model not found" } });
    return;
  }
  json(response, 429, {
    error: { code: "insufficient_quota", message: "Account quota exhausted" },
  });
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const scenario = scenarios.find((candidate) => path.startsWith(`/${candidate}/v1/`));
  if (request.method === "GET" && path.endsWith("/v1/models")) {
    json(response, 200, { data: [{ id: "fixture-model" }] });
    return;
  }
  if (request.method !== "POST" || !path.endsWith("/v1/chat/completions")) {
    json(response, 404, { error: { code: "not_found" } });
    return;
  }
  const body = await collectBody(request);
  if (scenario === "network") {
    request.socket.destroy();
    return;
  }
  if (scenario) {
    failure(response, scenario);
    return;
  }
  if (path !== "/success/v1/chat/completions") {
    json(response, 404, { error: { code: "not_found" } });
    return;
  }
  json(response, 200, {
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            translations: translationIds(body).map((id) => ({ id, text: `fixture:${id}` })),
          }),
        },
      },
    ],
  });
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("LISTEN_FAILED");
  const root = `http://127.0.0.1:${address.port}`;
  process.stdout.write("Session feedback fixture\n");
  process.stdout.write("Service type: OpenAI\nModel ID: fixture-model\nNetwork route: direct\n");
  for (const scenario of scenarios)
    process.stdout.write(
      `${scenario[0]!.toUpperCase()}${scenario.slice(1)}: ${root}/${scenario}/v1\n`,
    );
  process.stdout.write(`Success: ${root}/success/v1\n`);
});

const close = (): void => {
  server.close(() => process.exit(0));
};

process.once("SIGINT", close);
process.once("SIGTERM", close);
