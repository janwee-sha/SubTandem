export class TargetLanguageSession {
  private targetLanguage: string;
  private revision = 1;
  private pending: { requestId: string; targetLanguage: string } | null = null;

  constructor(initialTargetLanguage: string) {
    this.targetLanguage = initialTargetLanguage;
  }

  get snapshot(): { targetLanguage: string; revision: number } {
    return { targetLanguage: this.targetLanguage, revision: this.revision };
  }

  get pendingSave(): Readonly<{ requestId: string; targetLanguage: string }> | null {
    return this.pending ? { ...this.pending } : null;
  }

  begin(input: { requestId: string; revision: number; targetLanguage: string }): boolean {
    if (this.pending || input.revision !== this.revision) return false;
    this.pending = { requestId: input.requestId, targetLanguage: input.targetLanguage };
    return true;
  }

  commit(input: {
    requestId: string;
    targetLanguage: string;
  }): { targetLanguage: string; revision: number } | null {
    if (
      !this.pending ||
      input.requestId !== this.pending.requestId ||
      input.targetLanguage !== this.pending.targetLanguage
    )
      return null;
    this.targetLanguage = input.targetLanguage;
    this.revision += 1;
    this.pending = null;
    return this.snapshot;
  }

  fail(requestId: string): boolean {
    if (this.pending?.requestId !== requestId) return false;
    this.pending = null;
    return true;
  }

  close(): void {
    this.pending = null;
  }
}
