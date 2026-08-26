export type PlayerPost = (playerId: null | number | string, name: string, data: unknown) => void;
export type Defer = (callback: () => void, delayMs: number) => unknown;

export function createDeferredPlayerPost(post: PlayerPost, defer: Defer): PlayerPost {
  return (playerId, name, data) => {
    defer(() => post(playerId, name, data), 0);
  };
}
