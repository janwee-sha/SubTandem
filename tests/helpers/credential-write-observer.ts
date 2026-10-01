export class CredentialWriteObserver {
  readonly contents = new Map<string, string>();
  readonly writes: Array<{ path: string; content: string }> = [];
  list(path: string) {
    const prefix = `${path.replace(/\/+$/, "")}/`;
    return [...this.contents.keys()]
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => ({ filename: entry.slice(prefix.length), isDir: false }));
  }
  exists(path: string) {
    return this.contents.has(path);
  }
  read(path: string) {
    return this.contents.get(path) ?? null;
  }
  write(path: string, content: string) {
    this.writes.push({ path, content });
    this.contents.set(path, content);
  }
  delete(path: string) {
    this.contents.delete(path);
  }
  leakedWrites(secret: string) {
    const inspect = (value: unknown, depth = 0): boolean => {
      if (depth > 16) return true;
      if (typeof value === "string") {
        if (value.includes(secret)) return true;
        try {
          const parsed: unknown = JSON.parse(value);
          return typeof parsed === "string" && parsed === value
            ? false
            : inspect(parsed, depth + 1);
        } catch {
          return false;
        }
      }
      if (Array.isArray(value)) return value.some((entry) => inspect(entry, depth + 1));
      if (value && typeof value === "object")
        return Object.entries(value).some(
          ([key, entry]) => inspect(key, depth + 1) || inspect(entry, depth + 1),
        );
      return false;
    };
    return this.writes.filter((entry) => inspect(entry.content));
  }
}
