interface Window {
  iina?: {
    postMessage(name: string, data: unknown): void;
    onMessage(name: string, callback: (data: unknown) => void): void;
  };
}
