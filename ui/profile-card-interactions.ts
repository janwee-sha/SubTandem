interface ProfilePointerStart {
  profileId: string;
  clientX: number;
  clientY: number;
  scrollPosition: number;
  controlAncestor: boolean;
  selectionCollapsed: boolean;
  detail: number;
  primary: boolean;
}

interface ProfilePointerFinish {
  clientX: number;
  clientY: number;
  scrollPosition: number;
  selectionCollapsed: boolean;
}

class ProfileCardInteractionCoordinator {
  private pointer: {
    profileId: string;
    clientX: number;
    clientY: number;
    scrollPosition: number;
  } | null = null;

  constructor(private readonly movementThreshold = 5) {}

  beginPointer(input: ProfilePointerStart): boolean {
    this.pointer = null;
    if (!input.primary || input.controlAncestor || !input.selectionCollapsed || input.detail !== 1)
      return false;
    this.pointer = {
      profileId: input.profileId,
      clientX: input.clientX,
      clientY: input.clientY,
      scrollPosition: input.scrollPosition,
    };
    return true;
  }

  finishPointer(input: ProfilePointerFinish): string | null {
    const pointer = this.pointer;
    this.pointer = null;
    if (
      !pointer ||
      !input.selectionCollapsed ||
      input.scrollPosition !== pointer.scrollPosition ||
      Math.abs(input.clientX - pointer.clientX) > this.movementThreshold ||
      Math.abs(input.clientY - pointer.clientY) > this.movementThreshold
    )
      return null;
    return pointer.profileId;
  }

  activateKey(profileId: string, key: string, controlAncestor: boolean): string | null {
    if (controlAncestor || (key !== "Enter" && key !== " ")) return null;
    return profileId;
  }

  cancel(): void {
    this.pointer = null;
  }
}

class ProfileDeleteDialogInteractionCoordinator {
  nextFocusIndex(currentIndex: number, focusableCount: number, backward: boolean): number {
    if (focusableCount < 1) return -1;
    const normalized = currentIndex >= 0 && currentIndex < focusableCount ? currentIndex : 0;
    return backward
      ? (normalized - 1 + focusableCount) % focusableCount
      : (normalized + 1) % focusableCount;
  }

  shouldCancel(key: string, submitted: boolean): boolean {
    return key === "Escape" && !submitted;
  }

  focusAfterRemoval(
    removedIndex: number,
    remainingProfileIds: string[],
  ): { kind: "profile-delete"; profileId: string } | { kind: "create-profile" } {
    const next = remainingProfileIds[removedIndex] ?? remainingProfileIds[removedIndex - 1];
    return next ? { kind: "profile-delete", profileId: next } : { kind: "create-profile" };
  }
}

interface Window {
  ProfileCardInteractionCoordinator: typeof ProfileCardInteractionCoordinator;
  ProfileDeleteDialogInteractionCoordinator: typeof ProfileDeleteDialogInteractionCoordinator;
}

(globalThis as typeof globalThis & Window).ProfileCardInteractionCoordinator =
  ProfileCardInteractionCoordinator;
(globalThis as typeof globalThis & Window).ProfileDeleteDialogInteractionCoordinator =
  ProfileDeleteDialogInteractionCoordinator;
