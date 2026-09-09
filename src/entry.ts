import { wirePlayer } from "./main.js";

let playerWired = false;
const initializePlayer = (): void => {
  if (playerWired || !iina.core.window.loaded) return;
  playerWired = true;
  wirePlayer(iina, `player-${Date.now()}`);
};
const scheduleInitializePlayer = (): void => {
  setTimeout(initializePlayer, 100);
};
iina.event.on("iina.window-loaded", scheduleInitializePlayer);
scheduleInitializePlayer();
