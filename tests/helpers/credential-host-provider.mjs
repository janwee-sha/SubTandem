import http from "node:http";
import { Buffer } from "node:buffer";
import process from "node:process";
import { URL } from "node:url";
import { setTimeout } from "node:timers";

const records = [];
const services = new Set(["openai", "claude", "deepseek", "ollama"]);
let mode = "normal";
let delayMs = 0;
const server = http.createServer(async (request, response) => {
  const reply = (status, value) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(value));
  };
  if (request.url === "/__evidence") return reply(200, { records });
  if (request.url.startsWith("/__control?")) {
    const control = new URL(request.url, "http://127.0.0.1");
    const requestedMode = control.searchParams.get("mode") ?? "normal";
    if (
      ![
        "normal",
        "delay",
        "fail",
        "reflect-raw",
        "reflect-escaped",
        "reflect-nested",
        "reflect-property",
      ].includes(requestedMode)
    )
      return reply(400, { error: "Invalid synthetic mode" });
    mode = requestedMode;
    delayMs = Math.max(0, Math.min(35000, Number(control.searchParams.get("delayMs")) || 0));
    return reply(200, { mode, delayMs });
  }
  const [kind, ...rest] = request.url.slice(1).split("/");
  if (!services.has(kind)) return reply(404, { error: "Unknown synthetic service" });
  const path = `/${rest.join("/")}`;
  const supplied = kind === "claude" ? request.headers["x-api-key"] : request.headers.authorization;
  const expected = `${kind === "claude" ? "" : "Bearer "}synthetic-host-${kind}-key`;
  const authentication =
    supplied === undefined ? "none" : supplied === expected ? "correct" : "unexpected";
  records.push({ kind, method: request.method, path, authentication, mode });
  if (authentication === "unexpected")
    return reply(401, { error: "Synthetic authentication mismatch" });
  const responseMode = mode;
  if (responseMode === "delay") await new Promise((resolve) => setTimeout(resolve, delayMs));
  if (responseMode === "fail") return reply(503, { error: "Synthetic service unavailable" });
  const reflection = `synthetic-host-${kind}-key`;
  if (responseMode === "reflect-raw") return reply(200, { error: reflection });
  if (responseMode === "reflect-nested")
    return reply(200, { error: JSON.stringify({ value: reflection }) });
  if (responseMode === "reflect-property") return reply(200, { [reflection]: true });
  if (responseMode === "reflect-escaped") {
    response.writeHead(200, { "Content-Type": "application/json" });
    return response.end(JSON.stringify({ error: reflection }).replaceAll("s", "\\u0073"));
  }
  if (request.method === "GET") {
    if (path === "/api/version") return reply(200, { version: "0.12.0" });
    if (path === "/api/tags")
      return reply(200, { models: [{ name: "model-a", model: "model-a" }] });
    return reply(200, {
      data: [{ id: "model-a", object: "model", display_name: "model-a" }],
      has_more: false,
    });
  }
  try {
    let bytes = 0;
    const chunks = [];
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > 1048576) throw new Error("Synthetic request too large");
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const user = body.messages?.findLast((message) => message.role === "user")?.content ?? "{}";
    const text = typeof user === "string" ? user : (user[0]?.text ?? "{}");
    const marker = text.match(/INPUT_JSON_BEGIN\s*([\s\S]*?)\s*INPUT_JSON_END/);
    const task = JSON.parse(marker?.[1] ?? text);
    const output = JSON.stringify({
      translations: (task.targets ?? []).map((target) => ({
        id: target.id,
        text: "Synthetic translation.",
      })),
    });
    if (kind === "claude")
      return reply(200, {
        id: "synthetic",
        type: "message",
        role: "assistant",
        model: "model-a",
        content: [{ type: "text", text: output }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    if (kind === "ollama")
      return reply(200, {
        model: "model-a",
        message: { role: "assistant", content: output },
        done: true,
      });
    return reply(200, {
      choices: [{ message: { role: "assistant", content: output }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
  } catch {
    return reply(400, { error: "Invalid synthetic request" });
  }
});
server.listen(51030, "127.0.0.1", () =>
  process.stdout.write("Synthetic provider listening on 127.0.0.1:51030\n"),
);
