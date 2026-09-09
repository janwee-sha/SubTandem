import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

export const metricPrefix = "[SubTandem language detection] ";
const percentile = (values, fraction) =>
  values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] : null;
const duration = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

export function summarizeHostMetrics(input) {
  const records = [];
  for (const line of input.split(/\r?\n/)) {
    const offset = line.indexOf(metricPrefix);
    if (offset < 0) continue;
    try {
      const record = JSON.parse(line.slice(offset + metricPrefix.length));
      if (
        !record ||
        Object.keys(record).sort().join(",") !== "elapsedMs,kind,state,stepDurationsMs" ||
        !["first", "repeat"].includes(record.kind) ||
        !["reliable", "unknown", "unsupported"].includes(record.state) ||
        !duration(record.elapsedMs) ||
        !Array.isArray(record.stepDurationsMs) ||
        record.stepDurationsMs.length === 0 ||
        !record.stepDurationsMs.every(duration)
      )
        continue;
      records.push(record);
    } catch {
      continue;
    }
  }
  const first = records.filter((record) => record.kind === "first");
  const repeat = records.filter((record) => record.kind === "repeat");
  const firstP95Ms = percentile(
    first.map((record) => record.elapsedMs),
    0.95,
  );
  const repeatP95Ms = percentile(
    repeat.map((record) => record.elapsedMs),
    0.95,
  );
  const stepP99Ms = percentile(
    records.flatMap((record) => record.stepDurationsMs),
    0.99,
  );
  const maxMs = records.length ? Math.max(...records.map((record) => record.elapsedMs)) : null;
  const complete = first.length >= 40 && repeat.length >= 40;
  return {
    firstCount: first.length,
    repeatCount: repeat.length,
    firstP95Ms,
    repeatP95Ms,
    stepP99Ms,
    maxMs,
    complete,
    passed: complete && firstP95Ms <= 100 && repeatP95Ms <= 50 && stepP99Ms <= 16 && maxMs <= 500,
  };
}

export function createValidationServer() {
  const metrics = { modelCalls: 0, probeCalls: 0, translationCalls: 0, translatedCues: 0 };
  return createServer(async (request, response) => {
    const send = (status, value) => {
      response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(value));
    };
    if (request.method === "GET" && request.url === "/metrics") {
      send(200, metrics);
      return;
    }
    if (request.method === "GET" && request.url === "/v1/models") {
      metrics.modelCalls++;
      send(200, {
        object: "list",
        data: [{ id: "validation-model", object: "model", owned_by: "local-validation" }],
      });
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      send(404, { error: "NOT_FOUND" });
      return;
    }
    try {
      let body = "";
      request.setEncoding("utf8");
      for await (const chunk of request) {
        body += chunk.toString("utf8");
        if (Buffer.byteLength(body) > 1_048_576) {
          send(413, { error: "REQUEST_TOO_LARGE" });
          return;
        }
      }
      const payload = JSON.parse(body);
      const user = payload.messages?.findLast((message) => message.role === "user");
      const targets = JSON.parse(user?.content ?? "{}").targets;
      if (
        payload.model !== "validation-model" ||
        !Array.isArray(targets) ||
        targets.length < 1 ||
        targets.length > 25 ||
        targets.some(
          (target) =>
            typeof target.id !== "string" ||
            !/^(?:probe|c\d+)$/.test(target.id) ||
            typeof target.text !== "string",
        ) ||
        new Set(targets.map((target) => target.id)).size !== targets.length
      ) {
        send(400, { error: "INVALID_REQUEST" });
        return;
      }
      const probe = targets.length === 1 && targets[0].id === "probe";
      if (probe) metrics.probeCalls++;
      else {
        metrics.translationCalls++;
        metrics.translatedCues += targets.length;
      }
      send(200, {
        id: "local-validation",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({
                translations: targets.map((target) => ({
                  id: target.id,
                  text: `Validation translation ${target.id}`,
                })),
              }),
            },
          },
        ],
      });
    } catch {
      send(400, { error: "INVALID_REQUEST" });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "host-metrics") {
    let input = "";
    for await (const chunk of process.stdin) input += chunk.toString("utf8");
    const report = summarizeHostMetrics(input);
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (!report.passed) process.exitCode = 1;
  } else if (process.argv[2] === "serve") {
    const index = process.argv.indexOf("--port");
    const port = index < 0 ? 8765 : Number(process.argv[index + 1]);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("INVALID_PORT");
    const server = createValidationServer();
    server.listen(port, "127.0.0.1", () =>
      process.stdout.write(
        JSON.stringify({ host: "127.0.0.1", port: server.address().port }) + "\n",
      ),
    );
    const close = () => {
      server.close();
      server.closeAllConnections();
    };
    process.on("SIGTERM", close);
    process.on("SIGINT", close);
  } else {
    process.stderr.write(
      "Usage: node scripts/language-detection-validation.mjs serve [--port 8765] | host-metrics\n",
    );
    process.exitCode = 1;
  }
}
