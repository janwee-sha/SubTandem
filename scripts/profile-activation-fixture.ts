import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

interface FixtureOptions {
  delayMs: number;
  invalidationPath: string | null;
  lockHeld: boolean;
}

interface ProfileRecord {
  profileId: string;
  revision: number;
}

interface CredentialDocument {
  formatVersion: number;
  storeId: string;
  storeRevision: number;
  lastCommit: { commitId: string; operation: string; baseRevision: number; requestDigest: string };
  profileState: {
    profiles: ProfileRecord[];
    activation: { profileId: string; profileRevision: number } | null;
  };
}

function parseOptions(argv: readonly string[]): FixtureOptions {
  let delayMs = 1500;
  let invalidationPath: string | null = null;
  let lockHeld = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--lock-held") {
      lockHeld = true;
      continue;
    }
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
  return { delayMs, invalidationPath, lockHeld };
}

function parseDocument(path: string): CredentialDocument {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let value: unknown;
  try {
    const stat = fstatSync(descriptor);
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid!() ||
      stat.nlink !== 1 ||
      stat.size > 1_048_576
    )
      throw new Error("INVALID_FILE");
    try {
      value = JSON.parse(readFileSync(descriptor, "utf8"));
    } catch {
      throw new Error("INVALID_DOCUMENT");
    }
  } finally {
    closeSync(descriptor);
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_DOCUMENT");
  const document = value as Partial<CredentialDocument>;
  const profileState = document.profileState;
  if (
    document.formatVersion !== 2 ||
    typeof document.storeId !== "string" ||
    !Number.isSafeInteger(document.storeRevision) ||
    document.storeRevision! < 1 ||
    document.storeRevision! >= Number.MAX_SAFE_INTEGER ||
    !document.lastCommit ||
    document.lastCommit.baseRevision !== document.storeRevision! - 1 ||
    !/^[a-f0-9]{64}$/.test(document.lastCommit.requestDigest) ||
    !profileState ||
    !Array.isArray(profileState.profiles) ||
    !profileState.activation ||
    typeof profileState.activation.profileId !== "string" ||
    profileState.activation.profileId.length === 0 ||
    !Number.isSafeInteger(profileState.activation.profileRevision)
  )
    throw new Error("INVALID_DOCUMENT");
  const record = value as Record<string, unknown>;
  for (const [field, keys] of [
    ["credentials", ["credentialId", "envelope"]],
    ["keyRing", ["keyId", "wrappedRepresentation"]],
  ] as const) {
    const entries = record[field];
    if (!entries || typeof entries !== "object" || Array.isArray(entries))
      throw new Error("INVALID_DOCUMENT");
    for (const entry of Object.values(entries)) {
      if (
        !entry ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        Object.keys(entry).sort().join(",") !== [...keys].sort().join(",") ||
        Object.values(entry).some((part) => typeof part !== "string")
      )
        throw new Error("INVALID_DOCUMENT");
    }
  }
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

function invalidateRestoration(path: string, lockHeld: boolean): void {
  parseDocument(path);
  if (!lockHeld) {
    const lock = openSync(
      join(dirname(path), ".credentials.lock"),
      constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const stat = fstatSync(lock);
      if (!stat.isFile() || stat.uid !== process.getuid!() || stat.nlink !== 1)
        throw new Error("INVALID_LOCK");
      const result = spawnSync(
        "/usr/bin/lockf",
        [
          "-k",
          "-t",
          "0",
          "/dev/fd/3",
          process.execPath,
          ...process.execArgv,
          process.argv[1]!,
          ...process.argv.slice(2),
          "--lock-held",
        ],
        { stdio: ["inherit", "inherit", "inherit", lock] },
      );
      if (result.error || result.status !== 0) throw new Error("FIXTURE_LOCK_OR_UPDATE_FAILED");
    } finally {
      closeSync(lock);
    }
    return;
  }
  const locked = lstatSync(join(dirname(path), ".credentials.lock"));
  if (
    !locked.isFile() ||
    locked.isSymbolicLink() ||
    locked.uid !== process.getuid!() ||
    locked.nlink !== 1
  )
    throw new Error("INVALID_LOCK");
  const document = parseDocument(path);
  const directory = dirname(path);
  const backup = join(directory, `.${basename(path)}.v2-activation-backup-${randomUUID()}`);
  const temporary = join(directory, `.${basename(path)}.v2-activation-fixture-${randomUUID()}.tmp`);
  copyFileSync(path, backup, constants.COPYFILE_EXCL);
  chmodSync(backup, 0o600);
  const activation = document.profileState.activation;
  if (!activation || activation.profileRevision >= Number.MAX_SAFE_INTEGER) {
    unlinkSync(backup);
    throw new Error("INVALID_REVISION");
  }
  activation.profileRevision += 1;
  const baseRevision = document.storeRevision;
  document.storeRevision += 1;
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object")
      return `{${Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
        .join(",")}}`;
    return JSON.stringify(value);
  };
  document.lastCommit = {
    commitId: randomUUID(),
    operation: "commit",
    baseRevision,
    requestDigest: createHash("sha256").update(canonical(document.profileState)).digest("hex"),
  };
  let descriptor: number | null = null;
  const directoryFD = openSync(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const backupFD = openSync(backup, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      fsyncSync(backupFD);
    } finally {
      closeSync(backupFD);
    }
    fsyncSync(directoryFD);
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(document)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, path);
    chmodSync(path, 0o600);
    fsyncSync(directoryFD);
    if (readFileSync(path, "utf8") !== `${JSON.stringify(document)}\n`)
      throw new Error("FIXTURE_UNCONFIRMED");
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  } finally {
    closeSync(directoryFD);
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
    invalidateRestoration(options.invalidationPath, options.lockHeld);
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
