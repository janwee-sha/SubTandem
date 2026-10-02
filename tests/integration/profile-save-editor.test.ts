import { describe, expect, it } from "vitest";
import { p256 } from "@noble/curves/nist.js";
import { sidebarHarness } from "../helpers/sidebar-harness.js";
import { ProviderProfiles } from "../../src/providers/profiles.js";
import {
  credentialBase64,
  credentialDecode,
  credentialHandshakeAAD,
  credentialKeyInfo,
  credentialNonce,
  credentialOperationAAD,
  credentialText,
  parseCredentialOffer,
} from "../../shared/credential-protocol.js";
import {
  deriveCredentialKey,
  openCredentialBytes,
  sealCredentialBytes,
} from "../../ui/credential-channel.js";

async function tick() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("production drawer atomic Save", () => {
  it.each(["synthetic-dom-key-秘密", ""])(
    "seals the clicked value and saves once: %s",
    async (value) => {
      const h = sidebarHarness();
      h.receive("profile-activation:state", {
        authorityId: "authority",
        stateVersion: 1,
        ready: true,
        activationGeneration: 0,
        activation: null,
        profiles: [],
      });
      h.element("#new-profile").dispatch("click");
      h.element("#profile-name").value = "Synthetic";
      h.element("#provider-model").value = "synthetic-model";
      h.element("#provider-model").dispatch("input");
      h.element("#provider-key").value = value;
      h.element("#provider-key").dispatch("input");
      h.element("#save-profile").dispatch("click");
      const opening = h.messages.findLast((entry) => entry.name === "credential-channel:open")!
        .data as any;
      expect(opening).toBeDefined();
      const secret = p256.utils.randomSecretKey();
      const offer = parseCredentialOffer({
        ...opening.payload,
        senderId: "real-window",
        helperSessionId: "helper",
        channelId: "channel",
        helperPublicKey: credentialBase64(p256.getPublicKey(secret, false)),
        salt: credentialBase64(new Uint8Array(32).fill(7)),
      });
      const reply = (event: string, requestId: string, payload: unknown) =>
        h.receive(event, {
          requestId,
          ok: true,
          sidebarInstanceId: offer.sidebarInstanceId,
          drawerId: offer.drawerId,
          payload,
        });
      reply("credential-channel:result", opening.requestId, offer);
      await tick();
      const confirmation = h.messages.findLast(
        (entry) => entry.name === "credential-channel:confirm",
      )!.data as any;
      const sendKey = deriveCredentialKey(
        secret,
        credentialDecode(offer.clientPublicKey, 65),
        credentialDecode(offer.salt, 32),
        credentialKeyInfo(offer, "helper-to-sidebar"),
      );
      const acknowledgement = {
        ...confirmation.payload,
        sealedPayload: credentialBase64(
          sealCredentialBytes(
            sendKey,
            credentialNonce(0),
            new Uint8Array(),
            credentialHandshakeAAD(offer, "helper-to-sidebar"),
          ),
        ),
      };
      reply("credential-channel:result", confirmation.requestId, acknowledgement);
      await tick();
      const prepare = h.messages.findLast((entry) => entry.name === "profile:save-prepare")!
        .data as any;
      const profile = new ProviderProfiles(
        () => "10000000-0000-4000-8000-000000000001",
      ).createSaveCandidate(prepare.payload.input);
      const reservation = {
        reservationId: "reservation",
        requestId: prepare.requestId,
        expiresAtMs: Date.now() + 30_000,
        commitId: "10000000-0000-4000-8000-000000000002",
        expectedStoreRevision: 1,
        expectedProfileRevision: null,
        profile,
        profileState: { profiles: [profile], activation: null },
        sourceProfile: null,
      };
      h.element("#provider-key").value = "late-dom-value";
      reply("profile:save-result", prepare.requestId, reservation);
      await tick();
      const commit = h.messages.findLast((entry) => entry.name === "profile:save-commit")!
        .data as any;
      expect(commit.payload.reservationId).toBe("reservation");
      const frame = commit.payload.frame;
      const receiveKey = deriveCredentialKey(
        secret,
        credentialDecode(offer.clientPublicKey, 65),
        credentialDecode(offer.salt, 32),
        credentialKeyInfo(offer, "sidebar-to-helper"),
      );
      const recovered = openCredentialBytes(
        receiveKey,
        credentialNonce(frame.sequence),
        credentialDecode(frame.sealedPayload, 32768),
        credentialOperationAAD(offer, "sidebar-to-helper", frame.sequence, frame.context),
      );
      expect(credentialText(recovered)).toBe(value);
      expect(frame.context.submitEpoch).toBe(1);
      expect(frame.context.keyEditEpoch).toBe(1);
      expect(JSON.stringify(h.messages)).not.toContain("synthetic-dom-key");
      expect(
        h.messages.some((entry) =>
          ["profile:save", "secret:set", "credential:set"].includes(entry.name),
        ),
      ).toBe(false);
      reply("profile:save-result", commit.requestId, {
        profile: { ...profile, credentialConfigured: Boolean(value) },
        selectionInvalidated: false,
      });
      await tick();
      expect(h.element("#provider-key").value).toBe("");
      expect(h.element("#save-profile").disabled).toBe(false);
      expect(h.element("#profile-editor-status").textContent).toBe("");
      h.event("pagehide");
    },
  );
});
