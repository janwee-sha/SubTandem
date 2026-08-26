export interface ProfileListItem {
  profileId: string;
}

export interface ProfileListSyncState<T extends ProfileListItem> {
  sequence: number;
  latestRequestId: string | null;
  profiles: T[];
}

export function createProfileListSyncState<T extends ProfileListItem>(
  profiles: T[] = [],
): ProfileListSyncState<T> {
  return { sequence: 0, latestRequestId: null, profiles: [...profiles] };
}

export function beginProfileListRequest<T extends ProfileListItem>(
  state: ProfileListSyncState<T>,
  scopeId: string,
): { state: ProfileListSyncState<T>; requestId: string } {
  const sequence = state.sequence + 1;
  const requestId = `profiles:${scopeId}:${sequence}`;
  return {
    requestId,
    state: { ...state, sequence, latestRequestId: requestId },
  };
}

export function acceptProfileListResult<T extends ProfileListItem>(
  state: ProfileListSyncState<T>,
  requestId: string,
  profiles: T[],
): ProfileListSyncState<T> {
  return requestId === state.latestRequestId ? { ...state, profiles: [...profiles] } : state;
}

export function removeDeletedProfile<T extends ProfileListItem>(
  state: ProfileListSyncState<T>,
  profileId: string,
): ProfileListSyncState<T> {
  return {
    ...state,
    profiles: state.profiles.filter((profile) => profile.profileId !== profileId),
  };
}

export function upsertCreatedProfile<T extends ProfileListItem>(
  state: ProfileListSyncState<T>,
  profile: T,
): ProfileListSyncState<T> {
  const index = state.profiles.findIndex((item) => item.profileId === profile.profileId);
  const profiles = [...state.profiles];
  if (index >= 0) profiles[index] = profile;
  else profiles.push(profile);
  return { ...state, latestRequestId: null, profiles };
}

export function markProfileCredentialConfigured<
  T extends ProfileListItem & { credentialConfigured?: boolean },
>(state: ProfileListSyncState<T>, profileId: string): ProfileListSyncState<T> {
  const profile = state.profiles.find((item) => item.profileId === profileId);
  if (!profile || profile.credentialConfigured) return state;
  return {
    ...state,
    profiles: state.profiles.map((item) =>
      item.profileId === profileId ? { ...item, credentialConfigured: true } : item,
    ),
  };
}
