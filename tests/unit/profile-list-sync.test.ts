import { describe, expect, it } from "vitest";
import {
  acceptProfileListResult,
  beginProfileListRequest,
  createProfileListSyncState,
  markProfileCredentialConfigured,
  removeDeletedProfile,
  upsertCreatedProfile,
} from "../../src/adapters/iina/profile-list-sync.js";

interface Profile {
  profileId: string;
  revision: number;
}

describe("Main profile list synchronization", () => {
  it("commits only the latest request when A and B resolve in reverse order", () => {
    let state = createProfileListSyncState<Profile>([{ profileId: "initial", revision: 1 }]);
    const first = beginProfileListRequest(state, "window-A");
    state = first.state;
    const second = beginProfileListRequest(state, "window-A");
    state = second.state;

    state = acceptProfileListResult(state, first.requestId, [{ profileId: "stale", revision: 1 }]);
    expect(state.profiles).toEqual([{ profileId: "initial", revision: 1 }]);

    state = acceptProfileListResult(state, second.requestId, [
      { profileId: "latest", revision: 2 },
    ]);
    expect(state.profiles).toEqual([{ profileId: "latest", revision: 2 }]);
  });

  it("filters the authoritative snapshot before requesting a post-delete refresh", () => {
    let state = createProfileListSyncState<Profile>([
      { profileId: "deleted", revision: 2 },
      { profileId: "retained", revision: 1 },
    ]);
    state = removeDeletedProfile(state, "deleted");
    expect(state.profiles).toEqual([{ profileId: "retained", revision: 1 }]);

    const refresh = beginProfileListRequest(state, "window-A");
    expect(refresh.state.profiles).toEqual([{ profileId: "retained", revision: 1 }]);
    expect(refresh.requestId).toContain("window-A");
  });

  it("uses a scoped monotonic identity instead of a timestamp-only identity", () => {
    const initial = createProfileListSyncState<Profile>();
    const first = beginProfileListRequest(initial, "window-A");
    const second = beginProfileListRequest(first.state, "window-A");
    const other = beginProfileListRequest(initial, "window-B");

    expect(new Set([first.requestId, second.requestId, other.requestId]).size).toBe(3);
    expect(second.state.sequence).toBe(2);
  });

  it("shows a created revision immediately and rejects a list started before creation", () => {
    let state = createProfileListSyncState<Profile>([{ profileId: "retained", revision: 1 }]);
    const stale = beginProfileListRequest(state, "window-A");
    state = stale.state;

    state = upsertCreatedProfile(state, { profileId: "created", revision: 1 });
    expect(state.profiles).toEqual([
      { profileId: "retained", revision: 1 },
      { profileId: "created", revision: 1 },
    ]);

    state = acceptProfileListResult(state, stale.requestId, [
      { profileId: "retained", revision: 1 },
    ]);
    expect(state.profiles.map((profile) => profile.profileId)).toEqual(["retained", "created"]);
  });

  it("replaces an existing profile revision without changing its list position", () => {
    const state = upsertCreatedProfile(
      createProfileListSyncState<Profile>([
        { profileId: "updated", revision: 1 },
        { profileId: "retained", revision: 1 },
      ]),
      { profileId: "updated", revision: 2 },
    );

    expect(state.profiles).toEqual([
      { profileId: "updated", revision: 2 },
      { profileId: "retained", revision: 1 },
    ]);
  });

  it("immediately reflects an authoritative credential write in the current Profile view", () => {
    const state = createProfileListSyncState([
      { profileId: "remote", revision: 2, credentialConfigured: false },
      { profileId: "retained", revision: 1, credentialConfigured: false },
    ]);

    const updated = markProfileCredentialConfigured(state, "remote");

    expect(updated.profiles).toEqual([
      { profileId: "remote", revision: 2, credentialConfigured: true },
      { profileId: "retained", revision: 1, credentialConfigured: false },
    ]);
  });
});
