import { hostTimers, type HostInterval, type HostTimers } from "./host-timers.js";

export interface GlobalMailboxFileStore {
  list(path: string): Array<{ filename: string; isDir: boolean }>;
  exists(path: string): boolean;
  read(path: string): string | null;
  write(path: string, content: string): void;
  delete(path: string): void;
}

export interface GlobalMailboxOptions {
  root?: string;
  pollIntervalMs?: number;
  messageTtlMs?: number;
  staleAfterMs?: number;
  heartbeatIntervalMs?: number;
  sessionTtlMs?: number;
  maxFrameBytes?: number;
  maxSecretBytes?: number;
  maxQueueDepth?: number;
  maxMessagesPerTick?: number;
  now?: () => number;
  nonce?: () => string;
  timers?: Pick<HostTimers, "setInterval">;
  onError?: (code: string) => void;
}

type MailboxDirection = "request" | "response";
type MailboxHandler = (data: unknown, playerId?: string) => unknown;

interface MailboxFrame {
  type: "subtandem-global-mailbox";
  protocolVersion: 1;
  direction: MailboxDirection;
  sourceId: string;
  targetId: string;
  name: string;
  createdAtMs: number;
  expiresAtMs: number;
  hasSecrets: boolean;
  data: unknown;
}

interface ParsedStem {
  stem: string;
  direction: MailboxDirection;
  playerId: string;
  createdAtMs: number;
  sequence: number;
}

interface MailboxLimits {
  root: string;
  pollIntervalMs: number;
  messageTtlMs: number;
  staleAfterMs: number;
  heartbeatIntervalMs: number;
  sessionTtlMs: number;
  maxFrameBytes: number;
  maxSecretBytes: number;
  maxQueueDepth: number;
  maxMessagesPerTick: number;
}

const FRAME_KEYS = [
  "createdAtMs",
  "data",
  "direction",
  "expiresAtMs",
  "hasSecrets",
  "name",
  "protocolVersion",
  "sourceId",
  "targetId",
  "type",
].join(",");
const SECRET_MARKER = "__subtandemMailboxSecret";
const PREFIX = "subtandem-mailbox-v1";
const GLOBAL_ID = "global";
const REGISTER_MESSAGE = "mailbox:register";
const HEARTBEAT_MESSAGE = "mailbox:heartbeat";
const CLOSE_MESSAGE = "mailbox:close";
const INTERNAL_MESSAGES = new Set([REGISTER_MESSAGE, HEARTBEAT_MESSAGE, CLOSE_MESSAGE]);
const DEFAULT_LIMITS: MailboxLimits = {
  root: "@tmp",
  pollIntervalMs: 50,
  messageTtlMs: 30_000,
  staleAfterMs: 300_000,
  heartbeatIntervalMs: 30_000,
  sessionTtlMs: 90_000,
  maxFrameBytes: 524_288,
  maxSecretBytes: 32_768,
  maxQueueDepth: 128,
  maxMessagesPerTick: 16,
};

let mailboxSequence = 0;
let playerSequence = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function utf8Length(value: string): number {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return length;
}

function validIdentity(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,64}$/.test(value);
}

function encodeIdentity(value: string): string {
  let encoded = "";
  for (let index = 0; index < value.length; index += 1) {
    encoded += value.charCodeAt(index).toString(16).padStart(2, "0");
  }
  return encoded;
}

function decodeIdentity(value: string): string | null {
  if (value.length === 0 || value.length % 2 !== 0) return null;
  let decoded = "";
  for (let index = 0; index < value.length; index += 2) {
    const code = Number.parseInt(value.slice(index, index + 2), 16);
    if (!Number.isFinite(code)) return null;
    decoded += String.fromCharCode(code);
  }
  return validIdentity(decoded) ? decoded : null;
}

function safeNonce(): string {
  return Math.random().toString(36).slice(2, 14).padEnd(12, "0").slice(0, 12);
}

function resolveLimits(options: GlobalMailboxOptions): MailboxLimits {
  return {
    root: options.root ?? DEFAULT_LIMITS.root,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_LIMITS.pollIntervalMs,
    messageTtlMs: options.messageTtlMs ?? DEFAULT_LIMITS.messageTtlMs,
    staleAfterMs: options.staleAfterMs ?? DEFAULT_LIMITS.staleAfterMs,
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? DEFAULT_LIMITS.heartbeatIntervalMs,
    sessionTtlMs: options.sessionTtlMs ?? DEFAULT_LIMITS.sessionTtlMs,
    maxFrameBytes: options.maxFrameBytes ?? DEFAULT_LIMITS.maxFrameBytes,
    maxSecretBytes: options.maxSecretBytes ?? DEFAULT_LIMITS.maxSecretBytes,
    maxQueueDepth: options.maxQueueDepth ?? DEFAULT_LIMITS.maxQueueDepth,
    maxMessagesPerTick: options.maxMessagesPerTick ?? DEFAULT_LIMITS.maxMessagesPerTick,
  };
}

function framePaths(root: string, stem: string) {
  return {
    payload: `${root}/${stem}.json`,
    ready: `${root}/${stem}.ready`,
    secrets: `${root}/${stem}.secrets.json`,
  };
}

function parseStem(filename: string): ParsedStem | null {
  const match = filename.match(
    /^subtandem-mailbox-v1-(request|response)-([0-9a-f]+)-([0-9a-z]+)-([0-9a-z]+)-([0-9a-z]{6,20})\.(?:json|ready|secrets\.json)$/,
  );
  if (!match) return null;
  const playerId = decodeIdentity(match[2]!);
  const createdAtMs = Number.parseInt(match[3]!, 36);
  const sequence = Number.parseInt(match[4]!, 36);
  if (!playerId || !Number.isSafeInteger(createdAtMs) || !Number.isSafeInteger(sequence)) {
    return null;
  }
  return {
    stem: filename.replace(/\.(?:json|ready|secrets\.json)$/, ""),
    direction: match[1] as MailboxDirection,
    playerId,
    createdAtMs,
    sequence,
  };
}

function detachSecrets(value: unknown): { data: unknown; secrets: string[] } {
  const secrets: string[] = [];
  let nodes = 0;
  const visit = (current: unknown, depth: number): unknown => {
    nodes += 1;
    if (depth > 16 || nodes > 5_000) throw new Error("MAILBOX_STRUCTURE_INVALID");
    if (Array.isArray(current)) {
      if (current.length > 2_000) throw new Error("MAILBOX_STRUCTURE_INVALID");
      return current.map((item) => visit(item, depth + 1));
    }
    if (!isRecord(current)) return current;
    const clone: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(current)) {
      if (key === "apiKey" && typeof item === "string") {
        if (secrets.length >= 8) throw new Error("MAILBOX_SECRET_LIMIT");
        const secretIndex = secrets.push(item) - 1;
        clone[key] = { [SECRET_MARKER]: secretIndex };
      } else {
        clone[key] = visit(item, depth + 1);
      }
    }
    return clone;
  };
  return { data: visit(value, 0), secrets };
}

function restoreSecrets(value: unknown, secrets: string[]): unknown {
  const used = new Set<number>();
  let nodes = 0;
  const visit = (current: unknown, depth: number): unknown => {
    nodes += 1;
    if (depth > 16 || nodes > 5_000) throw new Error("MAILBOX_STRUCTURE_INVALID");
    if (Array.isArray(current)) return current.map((item) => visit(item, depth + 1));
    if (!isRecord(current)) return current;
    const keys = Object.keys(current);
    if (keys.length === 1 && keys[0] === SECRET_MARKER) {
      const index = current[SECRET_MARKER];
      if (
        !Number.isInteger(index) ||
        (index as number) < 0 ||
        (index as number) >= secrets.length
      ) {
        throw new Error("MAILBOX_SECRET_INVALID");
      }
      used.add(index as number);
      return secrets[index as number];
    }
    const clone: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(current)) clone[key] = visit(item, depth + 1);
    return clone;
  };
  const restored = visit(value, 0);
  if (used.size !== secrets.length) throw new Error("MAILBOX_SECRET_INVALID");
  return restored;
}

function parseSecrets(value: string, maxBytes: number): string[] {
  if (utf8Length(value) > maxBytes) throw new Error("MAILBOX_SECRET_LIMIT");
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) throw new Error("MAILBOX_SECRET_INVALID");
  if (Object.keys(parsed).sort().join(",") !== "protocolVersion,type,values") {
    throw new Error("MAILBOX_SECRET_INVALID");
  }
  if (parsed.type !== "subtandem-secret-handoff" || parsed.protocolVersion !== 1) {
    throw new Error("MAILBOX_SECRET_INVALID");
  }
  if (!Array.isArray(parsed.values) || parsed.values.length === 0 || parsed.values.length > 8) {
    throw new Error("MAILBOX_SECRET_INVALID");
  }
  if (!parsed.values.every((item) => typeof item === "string")) {
    throw new Error("MAILBOX_SECRET_INVALID");
  }
  return parsed.values as string[];
}

function parseFrame(value: string, stem: ParsedStem, limits: MailboxLimits): MailboxFrame {
  if (utf8Length(value) > limits.maxFrameBytes) throw new Error("MAILBOX_FRAME_LIMIT");
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || Object.keys(parsed).sort().join(",") !== FRAME_KEYS) {
    throw new Error("MAILBOX_FRAME_INVALID");
  }
  if (
    parsed.type !== "subtandem-global-mailbox" ||
    parsed.protocolVersion !== 1 ||
    (parsed.direction !== "request" && parsed.direction !== "response") ||
    parsed.direction !== stem.direction ||
    !validIdentity(parsed.sourceId) ||
    !validIdentity(parsed.targetId) ||
    typeof parsed.name !== "string" ||
    !/^[A-Za-z0-9:_-]{1,96}$/.test(parsed.name) ||
    typeof parsed.createdAtMs !== "number" ||
    !Number.isSafeInteger(parsed.createdAtMs) ||
    typeof parsed.expiresAtMs !== "number" ||
    !Number.isSafeInteger(parsed.expiresAtMs) ||
    typeof parsed.hasSecrets !== "boolean"
  ) {
    throw new Error("MAILBOX_FRAME_INVALID");
  }
  if (
    parsed.createdAtMs !== stem.createdAtMs ||
    (stem.direction === "request" ? parsed.sourceId : parsed.targetId) !== stem.playerId ||
    parsed.expiresAtMs <= parsed.createdAtMs ||
    parsed.expiresAtMs - parsed.createdAtMs > limits.messageTtlMs
  ) {
    throw new Error("MAILBOX_FRAME_INVALID");
  }
  if (
    (stem.direction === "request" && parsed.targetId !== GLOBAL_ID) ||
    (stem.direction === "response" && parsed.sourceId !== GLOBAL_ID) ||
    (stem.direction === "response" && parsed.hasSecrets)
  ) {
    throw new Error("MAILBOX_FRAME_INVALID");
  }
  return parsed as unknown as MailboxFrame;
}

abstract class FileGlobalMailbox {
  protected readonly limits: MailboxLimits;
  protected readonly now: () => number;
  private readonly nonce: () => string;
  private readonly timers: Pick<HostTimers, "setInterval">;
  private readonly onError: (code: string) => void;
  private poller: HostInterval | null = null;

  protected constructor(
    protected readonly files: GlobalMailboxFileStore,
    options: GlobalMailboxOptions,
  ) {
    this.limits = resolveLimits(options);
    this.now = options.now ?? Date.now;
    this.nonce = options.nonce ?? safeNonce;
    this.timers = options.timers ?? hostTimers;
    this.onError = options.onError ?? (() => undefined);
  }

  protected start(): void {
    this.cleanupStale();
    this.poller = this.timers.setInterval(() => {
      try {
        this.poll();
      } catch {
        this.report("MAILBOX_POLL_FAILED");
      }
    }, this.limits.pollIntervalMs);
  }

  protected stop(): void {
    this.poller?.cancel();
    this.poller = null;
  }

  protected abstract poll(): void;

  protected report(code: string): void {
    this.onError(code);
  }

  protected list(): Array<{ filename: string; isDir: boolean }> {
    return this.files.list(`${this.limits.root}/`);
  }

  protected readyFiles(direction: MailboxDirection, playerId?: string): ParsedStem[] {
    const frames: ParsedStem[] = [];
    for (const entry of this.list()) {
      if (entry.isDir || !entry.filename.endsWith(".ready")) continue;
      const parsed = parseStem(entry.filename);
      if (!parsed || parsed.direction !== direction) continue;
      if (playerId !== undefined && parsed.playerId !== playerId) continue;
      frames.push(parsed);
    }
    return frames
      .sort(
        (left, right) =>
          left.createdAtMs - right.createdAtMs ||
          left.sequence - right.sequence ||
          left.stem.localeCompare(right.stem),
      )
      .slice(0, this.limits.maxMessagesPerTick);
  }

  protected publish(
    direction: MailboxDirection,
    playerId: string,
    name: string,
    data: unknown,
  ): void {
    if (!validIdentity(playerId) || !/^[A-Za-z0-9:_-]{1,96}$/.test(name)) {
      throw new Error("MAILBOX_MESSAGE_INVALID");
    }
    const depth = this.list().filter((entry) => {
      const parsed =
        !entry.isDir && entry.filename.endsWith(".ready") ? parseStem(entry.filename) : null;
      return parsed?.direction === direction;
    }).length;
    if (depth >= this.limits.maxQueueDepth) throw new Error("MAILBOX_QUEUE_FULL");
    const createdAtMs = this.now();
    const stem = [
      PREFIX,
      direction,
      encodeIdentity(playerId),
      createdAtMs.toString(36),
      (++mailboxSequence).toString(36),
      this.nonce(),
    ].join("-");
    const paths = framePaths(this.limits.root, stem);
    const detached = detachSecrets(data);
    if (direction === "response" && detached.secrets.length > 0) {
      throw new Error("MAILBOX_SECRET_DIRECTION_INVALID");
    }
    const frame: MailboxFrame = {
      type: "subtandem-global-mailbox",
      protocolVersion: 1,
      direction,
      sourceId: direction === "request" ? playerId : GLOBAL_ID,
      targetId: direction === "request" ? GLOBAL_ID : playerId,
      name,
      createdAtMs,
      expiresAtMs: createdAtMs + this.limits.messageTtlMs,
      hasSecrets: detached.secrets.length > 0,
      data: detached.data,
    };
    const serialized = JSON.stringify(frame);
    if (utf8Length(serialized) > this.limits.maxFrameBytes) {
      throw new Error("MAILBOX_FRAME_LIMIT");
    }
    let secretSerialized: string | null = null;
    if (detached.secrets.length > 0) {
      secretSerialized = JSON.stringify({
        type: "subtandem-secret-handoff",
        protocolVersion: 1,
        values: detached.secrets,
      });
      if (utf8Length(secretSerialized) > this.limits.maxSecretBytes) {
        throw new Error("MAILBOX_SECRET_LIMIT");
      }
    }
    try {
      if (secretSerialized !== null) this.files.write(paths.secrets, secretSerialized);
      this.files.write(paths.payload, serialized);
      this.files.write(paths.ready, "ready");
    } catch (error) {
      this.remove(stem);
      throw error;
    }
  }

  protected consume(
    stem: ParsedStem,
    expectedDirection: MailboxDirection,
    expectedPlayerId?: string,
  ): MailboxFrame | null {
    const paths = framePaths(this.limits.root, stem.stem);
    try {
      const serialized = this.files.read(paths.payload);
      if (serialized === null) {
        this.remove(stem.stem);
        return null;
      }
      const frame = parseFrame(serialized, stem, this.limits);
      if (frame.direction !== expectedDirection) throw new Error("MAILBOX_FRAME_INVALID");
      if (expectedPlayerId !== undefined && frame.targetId !== expectedPlayerId) return null;
      const currentTime = this.now();
      if (frame.createdAtMs > currentTime + 5_000 || frame.expiresAtMs < currentTime) {
        this.remove(stem.stem);
        return null;
      }
      if (frame.hasSecrets) {
        const secretSerialized = this.files.read(paths.secrets);
        if (secretSerialized === null) throw new Error("MAILBOX_SECRET_INVALID");
        const secrets = parseSecrets(secretSerialized, this.limits.maxSecretBytes);
        frame.data = restoreSecrets(frame.data, secrets);
      }
      this.remove(stem.stem);
      return frame;
    } catch {
      this.remove(stem.stem);
      this.report("MAILBOX_FRAME_REJECTED");
      return null;
    }
  }

  protected remove(stem: string): void {
    const paths = framePaths(this.limits.root, stem);
    for (const path of [paths.ready, paths.payload, paths.secrets]) {
      try {
        if (this.files.exists(path)) this.files.delete(path);
      } catch {
        this.report("MAILBOX_CLEANUP_FAILED");
      }
    }
  }

  protected cleanupExpired(direction: MailboxDirection, playerId?: string): void {
    const currentTime = this.now();
    for (const stem of this.readyFiles(direction, playerId)) {
      if (stem.createdAtMs + this.limits.messageTtlMs < currentTime) this.remove(stem.stem);
    }
  }

  private cleanupStale(): void {
    const currentTime = this.now();
    const staleStems = new Set<string>();
    for (const entry of this.list()) {
      if (entry.isDir) continue;
      const parsed = parseStem(entry.filename);
      if (!parsed) continue;
      if (
        currentTime - parsed.createdAtMs > this.limits.staleAfterMs ||
        parsed.createdAtMs - currentTime > this.limits.staleAfterMs
      ) {
        staleStems.add(parsed.stem);
      }
    }
    for (const stem of staleStems) this.remove(stem);
  }
}

export class MainGlobalMailbox extends FileGlobalMailbox {
  private readonly handlers = new Map<string, MailboxHandler>();
  private lastHeartbeatAt: number;
  private closed = false;

  constructor(
    files: GlobalMailboxFileStore,
    readonly playerId: string,
    options: GlobalMailboxOptions = {},
  ) {
    super(files, options);
    if (!validIdentity(playerId) || playerId === GLOBAL_ID)
      throw new Error("MAILBOX_PLAYER_INVALID");
    this.lastHeartbeatAt = this.now();
    this.start();
    this.publishInternal(REGISTER_MESSAGE);
  }

  onMessage(name: string, callback: (data: unknown) => unknown): void {
    this.handlers.set(name, callback);
  }

  postMessage(name: string, data: unknown): void {
    if (this.closed) throw new Error("MAILBOX_CLOSED");
    this.publish("request", this.playerId, name, data);
  }

  close(): void {
    if (this.closed) return;
    this.publishInternal(CLOSE_MESSAGE);
    this.closed = true;
    this.stop();
    for (const stem of this.readyFiles("response", this.playerId)) this.remove(stem.stem);
    this.handlers.clear();
  }

  protected poll(): void {
    if (this.closed) return;
    this.cleanupExpired("request", this.playerId);
    for (const stem of this.readyFiles("response", this.playerId)) {
      const frame = this.consume(stem, "response", this.playerId);
      if (!frame) continue;
      const handler = this.handlers.get(frame.name);
      if (handler) this.invoke(handler, frame.data);
    }
    const currentTime = this.now();
    if (currentTime - this.lastHeartbeatAt >= this.limits.heartbeatIntervalMs) {
      this.lastHeartbeatAt = currentTime;
      this.publishInternal(HEARTBEAT_MESSAGE);
    }
  }

  private publishInternal(name: string): void {
    try {
      this.publish("request", this.playerId, name, {});
    } catch {
      this.report("MAILBOX_INTERNAL_SEND_FAILED");
    }
  }

  private invoke(handler: MailboxHandler, data: unknown): void {
    try {
      const result = handler(data);
      if (result instanceof Promise) void result.catch(() => this.report("MAILBOX_HANDLER_FAILED"));
    } catch {
      this.report("MAILBOX_HANDLER_FAILED");
    }
  }
}

export class GlobalMailbox extends FileGlobalMailbox {
  private readonly handlers = new Map<string, MailboxHandler>();
  private readonly players = new Map<string, number>();
  private readonly sessionCloseHandlers = new Set<(playerId: string) => void>();
  private closed = false;

  constructor(files: GlobalMailboxFileStore, options: GlobalMailboxOptions = {}) {
    super(files, options);
    this.start();
  }

  onMessage(name: string, callback: MailboxHandler): void {
    this.handlers.set(name, callback);
  }

  onSessionClose(callback: (playerId: string) => void): void {
    this.sessionCloseHandlers.add(callback);
  }

  postMessage(playerId: null | number | string, name: string, data: unknown): void {
    if (this.closed) throw new Error("MAILBOX_CLOSED");
    if (playerId === null) {
      for (const target of this.players.keys()) this.publish("response", target, name, data);
      return;
    }
    const target = String(playerId);
    if (!this.players.has(target)) return;
    this.publish("response", target, name, data);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stop();
    this.handlers.clear();
    this.players.clear();
    this.sessionCloseHandlers.clear();
  }

  protected poll(): void {
    if (this.closed) return;
    this.cleanupExpired("response");
    const currentTime = this.now();
    for (const [playerId, lastSeenAt] of this.players) {
      if (currentTime - lastSeenAt <= this.limits.sessionTtlMs) continue;
      this.players.delete(playerId);
      this.notifySessionClose(playerId);
    }
    for (const stem of this.readyFiles("request")) {
      const frame = this.consume(stem, "request");
      if (!frame) continue;
      this.players.set(frame.sourceId, currentTime);
      if (frame.name === CLOSE_MESSAGE) {
        this.players.delete(frame.sourceId);
        this.notifySessionClose(frame.sourceId);
        continue;
      }
      if (INTERNAL_MESSAGES.has(frame.name)) continue;
      const handler = this.handlers.get(frame.name);
      if (handler) this.invoke(handler, frame.data, frame.sourceId);
    }
  }

  private notifySessionClose(playerId: string): void {
    for (const handler of this.sessionCloseHandlers) {
      try {
        handler(playerId);
      } catch {
        this.report("MAILBOX_SESSION_CLOSE_FAILED");
      }
    }
  }

  private invoke(handler: MailboxHandler, data: unknown, playerId: string): void {
    try {
      const result = handler(data, playerId);
      if (result instanceof Promise) void result.catch(() => this.report("MAILBOX_HANDLER_FAILED"));
    } catch {
      this.report("MAILBOX_HANDLER_FAILED");
    }
  }
}

export class IinaGlobalMailboxFileStore implements GlobalMailboxFileStore {
  constructor(private readonly file: IINA.API.File) {}

  list(path: string): Array<{ filename: string; isDir: boolean }> {
    return this.file.list(path, { includeSubDir: false });
  }

  exists(path: string): boolean {
    return this.file.exists(path);
  }

  read(path: string): string | null {
    return this.file.read(path) ?? null;
  }

  write(path: string, content: string): void {
    this.file.write(path, content);
  }

  delete(path: string): void {
    this.file.delete(path);
  }
}

export function createMailboxPlayerId(): string {
  playerSequence += 1;
  return ["player", Date.now().toString(36), playerSequence.toString(36), safeNonce()].join("-");
}
