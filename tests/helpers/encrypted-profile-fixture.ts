import type {
  ProfileActivationAuthority,
  ProfileSaveReservation,
} from "../../src/providers/profile-activation.js";
import type { SaveProfileInput } from "../../src/providers/profiles.js";
import {
  profileSaveRequestDigest,
  type ProfileStateCommitResult,
} from "../../src/transport/client.js";
import {
  credentialBase64,
  credentialDecode,
  credentialNonce,
  credentialOperationAAD,
  credentialUtf8,
} from "../../shared/credential-protocol.js";
import type {
  CredentialEnvelope,
  CredentialOperationContext,
  CredentialOperationSnapshot,
  CredentialOwner,
  CredentialSnapshotState,
} from "../../shared/credential-protocol.js";
import { credentialSnapshotDigest, sealCredentialBytes } from "../../ui/credential-channel.js";
import vectors from "../fixtures/credentials/channel-vectors.json";

export const encryptedSaveOwner: CredentialOwner = {
  senderId: "window-vector",
  sidebarInstanceId: "sidebar-vector",
  drawerId: "drawer-vector",
};

export function encryptedSaveFrame(
  state: CredentialSnapshotState,
  value = "synthetic-store-key",
  storeRevision = 7,
  commitId = "00000000-0000-4000-8000-000000000098",
  contextOverrides: Partial<CredentialOperationContext> = {},
  targetProfileId?: string,
): CredentialEnvelope {
  const profile = (
    targetProfileId
      ? state.profiles.find((entry) => entry.profileId === targetProfileId)
      : state.profiles[0]
  )!;
  const sourceProfile =
    contextOverrides.sourceProfile ??
    (profile.revision === 1
      ? null
      : {
          profileId: profile.profileId,
          profileRevision: profile.revision - 1,
          endpointFingerprint: profile.endpointFingerprint,
        });
  const snapshot: CredentialOperationSnapshot = {
    kind: profile.kind,
    endpoint: profile.endpoint,
    model: profile.model ?? null,
    proxyMode: profile.proxyMode,
    purpose: "save-profile",
    sourceProfile,
    save: {
      commitId,
      expectedStoreRevision: storeRevision,
      expectedProfileRevision: sourceProfile?.profileRevision ?? null,
      profileState: state,
    },
  };
  const bytes = credentialUtf8(JSON.stringify(snapshot));
  const context: CredentialOperationContext = {
    ...vectors.context,
    purpose: "save-profile",
    kind: profile.kind,
    sourceProfile,
    submitEpoch: 1,
    endpointFingerprint: profile.endpointFingerprint,
    snapshotDigest: credentialSnapshotDigest(bytes),
    ...contextOverrides,
  };
  const offer = { ...vectors.offer, protocolVersion: 2 as const, sourceProfile };
  const sealed = sealCredentialBytes(
    credentialDecode(vectors.vectors[0]!.key, 32),
    credentialNonce(1),
    credentialUtf8(value),
    credentialOperationAAD(offer, "sidebar-to-helper", 1, context),
  );
  return {
    protocolVersion: 2,
    channelId: offer.channelId,
    helperSessionId: offer.helperSessionId,
    sequence: 1,
    context,
    snapshotBytes: credentialBase64(bytes),
    sealedPayload: credentialBase64(sealed),
  };
}

export async function saveTestProfile(
  authority: ProfileActivationAuthority,
  input: SaveProfileInput,
  save?: (
    reservation: ProfileSaveReservation,
    frame: CredentialEnvelope,
  ) => Promise<ProfileStateCommitResult>,
) {
  const reservation = await authority.reserveProfileSave(input, encryptedSaveOwner, "test-save");
  const frame = encryptedSaveFrame(
    reservation.profileState,
    "",
    reservation.expectedStoreRevision,
    reservation.commitId,
    {
      sourceProfile: reservation.sourceProfile,
      requestId: reservation.requestId,
      expiresAtMs: reservation.expiresAtMs,
    },
    reservation.profile.profileId,
  );
  return authority.completeProfileSave(
    reservation.reservationId,
    encryptedSaveOwner,
    frame,
    async () =>
      save
        ? save(reservation, frame)
        : {
            state: "committed",
            initialized: true,
            storeRevision: reservation.expectedStoreRevision + 1,
            profileState: structuredClone(reservation.profileState),
            credentialConfigured: Object.fromEntries(
              reservation.profileState.profiles.map((profile) => [
                profile.profileId,
                profile.profileId === reservation.profile.profileId
                  ? false
                  : (authority.snapshot.profiles.find(
                      (current) => current.profileId === profile.profileId,
                    )?.credentialConfigured ?? false),
              ]),
            ),
            lastCommit: {
              commitId: reservation.commitId,
              operation: "save-profile",
              baseRevision: reservation.expectedStoreRevision,
              requestDigest: profileSaveRequestDigest(encryptedSaveOwner, frame),
            },
          },
  );
}
