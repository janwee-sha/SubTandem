import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";

interface FixtureOptions {
  delayMs: number;
  invalidationPath: string | null;
}

interface ProfileRecord {
  profileId: string;
  revision: number;
}

interface CredentialDocument {
  formatVersion: number;
  profileState: {
    profiles: ProfileRecord[];
    activation: { profileId: string; profileRevision: number } | null;
  };
}

function parseOptions(argv: readonly string[]): FixtureOptions {
  let delayMs = 1500;
  let invalidationPath: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--delay-ms") {
      const value = Number(argv[++index]);
      if (!Number.isSafeInteger(value) || value < 0 || value > 60_000)
        throw new Error("INVALID_DELAY");
      delayMs = value;
      continue;
    }
    if (argument === "--invalidate-restoration") {
      const value = argv[++index];
      if (!value || !isAbsolute(value)) throw new Error("ABSOLUTE_PATH_REQUIRED");
      invalidationPath = value;
      continue;
    }
    throw new Error("UNKNOWN_ARGUMENT");
  }
  return { delayMs, invalidationPath };
}

function parseDocument(path: string): CredentialDocument {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("INVALID_FILE");
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_DOCUMENT");
  const document = value as Partial<CredentialDocument>;
  const profileState = document.profileState;
  if (
    document.formatVersion !== 1 ||
    !profileState ||
    !Array.isArray(profileState.profiles) ||
    !profileState.activation ||
    typeof profileState.activation.profileId !== "string" ||
    profileState.activation.profileId.length === 0 ||
    !Number.isSafeInteger(profileState.activation.profileRevision)
  )
    throw new Error("INVALID_DOCUMENT");
  const profile = profileState.profiles.find(
    (candidate) =>
      candidate &&
      typeof candidate.profileId === "string" &&
      candidate.profileId === profileState.activation?.profileId &&
      Number.isSafeInteger(candidate.revision),
  );
  if (!profile || profile.revision !== profileState.activation.profileRevision)
    throw new Error("RESTORATION_NOT_ACTIVE");
  return document as CredentialDocument;
}

function invalidateRestoration(path: string): void {
  const document = parseDocument(path);
  const directory = dirname(path);
  const backup = join(directory, `.${basename(path)}.activation-backup-${randomUUID()}`);
  const temporary = join(directory, `.${basename(path)}.activation-fixture-${randomUUID()}.tmp`);
  copyFileSync(path, backup);
  chmodSync(backup, 0o600);
  const activation = document.profileState.activation;
  if (!activation || activation.profileRevision >= Number.MAX_SAFE_INTEGER) {
    unlinkSync(backup);
    throw new Error("INVALID_REVISION");
  }
  activation.profileRevision += 1;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(document)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
  process.stdout.write(`Backup: ${backup}\n`);
}

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
  const matches = strings.flatMap((value) =>
    [...value.matchAll(/"id"\s*:\s*"([^"]+)"/g)].map((match) => match[1]!),
  );
  return [...new Set(matches)].filter((value) => value !== "string");
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function listen(label: string, delayMs: number): Promise<{ server: Server; root: string }> {
  let requestCount = 0;
  const server = createServer(async (request, response) => {
    requestCount += 1;
    process.stdout.write(`${label} requests: ${requestCount}\n`);
    const body = await collectBody(request);
    setTimeout(() => {
      if (request.method === "GET" && request.url === "/v1/models") {
        json(response, 200, { data: [{ id: "model-a" }] });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/chat/completions") {
        const ids = translationIds(body);
        json(response, 200, {
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  translations: ids.map((id) => ({ id, text: `${label}:${id}` })),
                }),
              },
            },
          ],
        });
        return;
      }
      json(response, 404, { error: { code: "not_found" } });
    }, delayMs);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("LISTEN_FAILED");
  return { server, root: `http://127.0.0.1:${address.port}/v1` };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.invalidationPath) {
    invalidateRestoration(options.invalidationPath);
    return;
  }
  const a = await listen("A", options.delayMs);
  const b = await listen("B", options.delayMs);
  process.stdout.write(`A: ${a.root}\nB: ${b.root}\n`);
  const close = async (): Promise<void> => {
    await Promise.all(
      [a.server, b.server].map(
        (server) => new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
    process.exit(0);
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "FIXTURE_FAILED"}\n`);
  process.exitCode = 1;
});
