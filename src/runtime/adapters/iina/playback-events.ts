import type { PlaybackSession } from "../../app/playback-session.js";

export interface PlaybackEventPort {
  on(name: string, callback: () => void): void;
  positionMs(): number | null;
  paused(): boolean;
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(id: unknown): void;
}

export function attachPlaybackEvents(
  session: PlaybackSession,
  port: PlaybackEventPort,
): () => void {
  port.on("iina.file-loaded", () => session.onFileChanged());
  port.on("mpv.track-list", () => session.onTrackChanged());
  port.on("mpv.seek", () => session.onSeek(port.positionMs()));
  port.on("mpv.end-file", () => session.close());
  port.on("iina.window-will-close", () => session.close());
  const timer = port.setInterval(() => {
    session.updatePosition(port.positionMs());
    session.setPaused(port.paused());
  }, 350);
  return () => port.clearInterval(timer);
}
