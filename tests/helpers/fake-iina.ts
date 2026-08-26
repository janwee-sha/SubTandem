export interface FakeTrack {
  id: number;
  isExternal: boolean;
  title?: string;
  lang?: string;
}

export class FakeIinaFileSystem {
  readonly files = new Map<string, Uint8Array>();

  read(path: string): Uint8Array | null {
    const bytes = this.files.get(path);
    return bytes ? bytes.slice() : null;
  }

  write(path: string, bytes: Uint8Array): void {
    this.files.set(path, bytes.slice());
  }

  remove(path: string): void {
    this.files.delete(path);
  }
}

export class FakeIinaPreferences {
  readonly values = new Map<string, unknown>();
  readonly writes: Array<{ key: string; value: unknown }> = [];
  syncCount = 0;
  failNextSet = false;
  failNextSync = false;

  get(key: string): unknown {
    return this.values.get(key);
  }

  set(key: string, value: unknown): void {
    if (this.failNextSet) {
      this.failNextSet = false;
      throw new Error("FAKE_PREFERENCE_SET_FAILED");
    }
    this.values.set(key, value);
    this.writes.push({ key, value });
  }

  sync(): void {
    this.syncCount += 1;
    if (this.failNextSync) {
      this.failNextSync = false;
      throw new Error("FAKE_PREFERENCE_SYNC_FAILED");
    }
  }
}

export class FakeIinaOverlay {
  readonly loadedFiles: string[] = [];
  readonly clickableValues: boolean[] = [];
  readonly messages: Array<{ name: string; data: unknown }> = [];
  simpleModeCount = 0;
  showCount = 0;
  hideCount = 0;
  failSimpleMode = false;
  failLoad = false;
  failShow = false;
  private readonly listeners = new Map<string, Array<(data: unknown) => void>>();

  simpleMode(): void {
    if (this.failSimpleMode) throw new Error("FAKE_OVERLAY_SIMPLE_MODE_FAILED");
    this.simpleModeCount += 1;
    this.listeners.clear();
  }

  loadFile(path: string): void {
    if (this.failLoad) throw new Error("FAKE_OVERLAY_LOAD_FAILED");
    this.loadedFiles.push(path);
    this.listeners.clear();
  }

  setClickable(clickable: boolean): void {
    this.clickableValues.push(clickable);
  }

  show(): void {
    if (this.failShow) throw new Error("FAKE_OVERLAY_SHOW_FAILED");
    this.showCount += 1;
  }

  hide(): void {
    this.hideCount += 1;
  }

  postMessage(name: string, data: unknown): void {
    this.messages.push({ name, data });
  }

  onMessage(name: string, callback: (data: unknown) => void): void {
    const callbacks = this.listeners.get(name) ?? [];
    callbacks.push(callback);
    this.listeners.set(name, callbacks);
  }

  trigger(name: string, data: unknown = {}): void {
    for (const callback of this.listeners.get(name) ?? []) callback(data);
  }
}

export class FakeIinaEvent {
  private nextId = 0;
  private readonly listeners = new Map<string, Map<string, () => void>>();

  on(name: string, callback: () => void): string {
    const id = `event-${this.nextId}`;
    this.nextId += 1;
    const callbacks = this.listeners.get(name) ?? new Map<string, () => void>();
    callbacks.set(id, callback);
    this.listeners.set(name, callbacks);
    return id;
  }

  off(name: string, id: string): void {
    this.listeners.get(name)?.delete(id);
  }

  trigger(name: string): void {
    for (const callback of this.listeners.get(name)?.values() ?? []) callback();
  }
}

export class FakeIinaGlobal {
  readonly messages: Array<{ target?: null | number | string; name: string; data: unknown }> = [];

  postMessage(name: string, data: unknown): void;
  postMessage(target: null | number | string, name: string, data: unknown): void;
  postMessage(
    targetOrName: null | number | string,
    nameOrData: string | unknown,
    optionalData?: unknown,
  ): void {
    if (arguments.length === 2) {
      this.messages.push({ name: String(targetOrName), data: nameOrData });
      return;
    }
    this.messages.push({ target: targetOrName, name: String(nameOrData), data: optionalData });
  }
}

export class FakeIinaPlayer {
  position: number | null = null;
  paused = false;
  fullscreen = false;
  primaryId: number | null = null;
  secondId: number | null = null;
  tracks: FakeTrack[] = [];
  readonly mpvCommands: string[][] = [];
  readonly mpvProperties = new Map<string, unknown>();
  readonly files = new FakeIinaFileSystem();
  private readonly commandFailures: unknown[] = [];
  private readonly listeners = new Map<string, Map<string, (...args: unknown[]) => void>>();
  private nextListenerId = 1;

  command(name: string, args: readonly string[] = []): void {
    this.mpvCommands.push([name, ...args]);
    if (this.commandFailures.length > 0) throw this.commandFailures.shift();
  }

  failNextCommand(error: unknown = new Error("FAKE_MPV_COMMAND_FAILED")): void {
    this.commandFailures.push(error);
  }

  getFlag(name: string): boolean {
    return Boolean(this.mpvProperties.get(name));
  }

  getNumber(name: string): number {
    const value = this.mpvProperties.get(name);
    return typeof value === "number" ? value : Number(value);
  }

  getString(name: string): string {
    const value = this.mpvProperties.get(name);
    return value === undefined || value === null ? "" : String(value);
  }

  getNative<T>(name: string): T {
    return this.mpvProperties.get(name) as T;
  }

  set(name: string, value: unknown): void {
    this.mpvProperties.set(name, value);
  }

  on(event: string, callback: (...args: unknown[]) => void): string {
    const id = `fake-listener-${this.nextListenerId++}`;
    const eventListeners = this.listeners.get(event) ?? new Map();
    eventListeners.set(id, callback);
    this.listeners.set(event, eventListeners);
    return id;
  }

  off(event: string, id: string): void {
    const eventListeners = this.listeners.get(event);
    eventListeners?.delete(id);
    if (eventListeners?.size === 0) this.listeners.delete(event);
  }

  trigger(event: string, ...args: unknown[]): void {
    for (const callback of this.listeners.get(event)?.values() ?? []) callback(...args);
  }
}
