(function () {
  const { iina } = globalThis;
  const surface = "__SUBTANDEM_OBSERVER_SURFACE__";
  const file = iina.file;
  const originalWrite = file.write.bind(file);
  const secrets = ["openai", "claude", "deepseek", "ollama"].map(
    (kind) => `synthetic-host-${kind}-key`,
  );
  const state = { point: "before-write", writes: 0, secretMatches: 0, categories: {} };
  function contains(value, secret, depth = 0) {
    if (depth > 16) return true;
    if (typeof value === "string") {
      if (value.includes(secret)) return true;
      try {
        const parsed = JSON.parse(value);
        return parsed === value ? false : contains(parsed, secret, depth + 1);
      } catch {
        return false;
      }
    }
    if (Array.isArray(value)) return value.some((item) => contains(item, secret, depth + 1));
    if (value && typeof value === "object")
      return Object.entries(value).some(
        ([key, item]) => contains(key, secret, depth + 1) || contains(item, secret, depth + 1),
      );
    return false;
  }
  file.write = function (path, content) {
    state.writes++;
    state.secretMatches += secrets.filter((secret) => contains(content, secret)).length;
    const category = String(path).includes("mailbox")
      ? "mailbox"
      : String(path).includes(".rpc")
        ? "rpc"
        : "other";
    state.categories[category] = (state.categories[category] || 0) + 1;
    originalWrite(`@data/credential-write-observer-${surface}.json`, JSON.stringify(state));
    return originalWrite(path, content);
  };
})();
