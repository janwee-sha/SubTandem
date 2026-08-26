import { parseOverlayReady } from "../../domain/messages.js";
import {
  DEFAULT_OVERLAY_POSITION,
  DEFAULT_SUBTITLE_MARGIN_X,
  DEFAULT_SUBTITLE_MARGIN_Y,
  isOverlayPosition,
  type OverlayRegion,
} from "../../domain/overlay-position.js";

export interface TranslationOverlayWebView {
  simpleMode(): void;
  loadFile(path: string): void;
  setClickable(clickable: boolean): void;
  show(): void;
  hide(): void;
  postMessage(name: string, data: unknown): void;
  onMessage(name: string, callback: (data: unknown) => void): void;
}

export interface TranslationOverlayLifecycle {
  on(name: "iina.plugin-overlay-loaded", callback: () => void): string;
  off(name: string, id: string): void;
}

export class WebViewTranslationOverlay {
  private active = true;
  private ready = false;
  private pageRequested = false;
  private lifecycleId: string | null = null;
  private renderRevision = 0;
  private lines: string[] | null = null;
  private position = DEFAULT_OVERLAY_POSITION;
  private region: OverlayRegion = {
    top: 0,
    bottom: 1,
    marginX: DEFAULT_SUBTITLE_MARGIN_X,
    marginY: DEFAULT_SUBTITLE_MARGIN_Y,
  };

  constructor(
    private readonly overlay: TranslationOverlayWebView,
    private readonly lifecycle: TranslationOverlayLifecycle,
    private readonly report: (message: string) => void = () => undefined,
  ) {
    try {
      this.overlay.setClickable(false);
      this.lifecycleId = this.lifecycle.on("iina.plugin-overlay-loaded", () => this.loadPage());
      this.overlay.simpleMode();
      this.report("Translation overlay WebView warmup started.");
    } catch {
      this.fail();
    }
  }

  show(lines: readonly string[]): void {
    const current = lines.flatMap((line) => line.split(/\r\n|\r|\n/)).filter((line) => line.trim());
    if (current.length === 0) {
      this.clear();
      return;
    }
    this.renderRevision += 1;
    this.lines = current;
    if (this.ready) this.post("overlay:render", this.renderPayload());
  }

  clear(): void {
    this.renderRevision += 1;
    this.lines = null;
    if (this.ready) this.post("overlay:clear", { renderRevision: this.renderRevision });
  }

  setPosition(position: number): boolean {
    if (!isOverlayPosition(position)) return false;
    this.position = position;
    this.renderRevision += 1;
    if (this.ready) this.post("overlay:layout", this.layoutPayload());
    return true;
  }

  setRegion(region: OverlayRegion): void {
    this.region = { ...region };
    this.renderRevision += 1;
    if (this.ready) this.post("overlay:layout", this.layoutPayload());
  }

  close(): void {
    this.lines = null;
    this.active = false;
    this.ready = false;
    this.detachLifecycle();
    try {
      this.overlay.hide();
    } catch {
      return;
    }
  }

  private flush(): void {
    if (this.lines) this.post("overlay:render", this.renderPayload());
    else this.post("overlay:clear", { renderRevision: this.renderRevision });
  }

  private loadPage(): void {
    if (!this.active || this.pageRequested) return;
    this.pageRequested = true;
    this.detachLifecycle();
    try {
      this.overlay.loadFile("dist/ui/overlay.html");
      this.overlay.onMessage("overlay:ready", (raw) => this.acceptReady(raw));
      this.report("Translation overlay WebView warmup completed.");
    } catch {
      this.fail();
    }
  }

  private acceptReady(raw: unknown): void {
    try {
      parseOverlayReady(raw);
    } catch {
      return;
    }
    if (!this.active || this.ready) return;
    try {
      this.overlay.show();
      this.ready = true;
      this.report("Translation overlay WebView ready.");
      this.flush();
    } catch {
      this.fail();
    }
  }

  private fail(): void {
    if (!this.active) return;
    this.active = false;
    this.ready = false;
    this.detachLifecycle();
    this.report("Translation overlay WebView initialization failed.");
  }

  private detachLifecycle(): void {
    if (this.lifecycleId === null) return;
    this.lifecycle.off("iina.plugin-overlay-loaded", this.lifecycleId);
    this.lifecycleId = null;
  }

  private layoutPayload() {
    return {
      renderRevision: this.renderRevision,
      position: this.position,
      region: { ...this.region },
    };
  }

  private renderPayload() {
    return { ...this.layoutPayload(), lines: [...this.lines!] };
  }

  private post(name: string, data: unknown): void {
    if (!this.active) return;
    try {
      this.overlay.postMessage(name, data);
    } catch {
      this.active = false;
    }
  }
}
