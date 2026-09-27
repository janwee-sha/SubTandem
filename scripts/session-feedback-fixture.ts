import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const errorScenarios = ["authentication", "configuration", "network", "model", "quota"] as const;
const scenarios = [
  ...errorScenarios,
  "success",
  "delay-models",
  "delay-probe",
  "empty",
  "invalid",
  "truncated",
  "refusal",
  "both",
] as const;
type Scenario = (typeof scenarios)[number];
let controlledScenario: Scenario = "success";
const records: Array<{
  method: string;
  scenario: string;
  probe: boolean;
  targets: number;
  completed: boolean;
}> = [];
const delayMs = 5000;

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

function failure(response: ServerResponse, scenario: (typeof errorScenarios)[number]): void {
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
  if (request.method === "GET" && path === "/stats") {
    json(response, 200, { scenario: controlledScenario, records });
    return;
  }
  if (request.method === "POST" && path === "/control") {
    try {
      const input = JSON.parse(await collectBody(request)) as { scenario?: unknown };
      if (!scenarios.includes(input.scenario as Scenario)) throw new Error();
      controlledScenario = input.scenario as Scenario;
      json(response, 200, { scenario: controlledScenario });
    } catch {
      json(response, 400, { error: { code: "invalid_scenario" } });
    }
    return;
  }
  const scenario = path.startsWith("/controlled/v1/")
    ? controlledScenario
    : scenarios.find((candidate) => path.startsWith(`/${candidate}/v1/`));
  if (request.method === "GET" && path.endsWith("/v1/models")) {
    const record = {
      method: "GET",
      scenario: scenario ?? "success",
      probe: false,
      targets: 0,
      completed: false,
    };
    records.push(record);
    if (scenario === "delay-models") await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (response.destroyed) return;
    json(response, 200, {
      data: [
        { id: "fixture-model" },
        ...(scenario === "delay-models" ? [{ id: "late-model" }] : []),
      ],
    });
    record.completed = true;
    return;
  }
  if (!scenario || request.method !== "POST" || !path.endsWith("/v1/chat/completions")) {
    json(response, 404, { error: { code: "not_found" } });
    return;
  }
  const body = await collectBody(request);
  const ids = translationIds(body);
  const record = {
    method: "POST",
    scenario,
    probe: ids.includes("probe"),
    targets: ids.length,
    completed: false,
  };
  records.push(record);
  if (scenario === "network") {
    request.socket.destroy();
    return;
  }
  if (errorScenarios.includes(scenario as (typeof errorScenarios)[number])) {
    failure(response, scenario as (typeof errorScenarios)[number]);
    record.completed = true;
    return;
  }
  if (scenario === "delay-probe") await new Promise((resolve) => setTimeout(resolve, delayMs));
  if (response.destroyed) return;
  json(response, 200, {
    choices: [
      {
        finish_reason: scenario === "truncated" || scenario === "both" ? "length" : "stop",
        message: {
          ...(scenario === "refusal" || scenario === "both" ? { refusal: "Fixture refusal" } : {}),
          content:
            scenario === "invalid"
              ? "invalid fixture output"
              : JSON.stringify({
                  translations:
                    scenario === "empty" ? [] : ids.map((id) => ({ id, text: `fixture:${id}` })),
                }),
        },
      },
    ],
  });
  record.completed = true;
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
  process.stdout.write(`Controlled: ${root}/controlled/v1\nStats: ${root}/stats\n`);
});

const close = (): void => {
  server.close(() => process.exit(0));
};

process.once("SIGINT", close);
process.once("SIGTERM", close);
