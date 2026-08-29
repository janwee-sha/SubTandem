import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("IINA sidebar bundle contract", () => {
  const html = readFileSync(new URL("../../ui/sidebar.html", import.meta.url), "utf8");
  const sidebarCss = readFileSync(new URL("../../ui/sidebar.css", import.meta.url), "utf8");
  const sidebarSource = readFileSync(new URL("../../ui/sidebar.ts", import.meta.url), "utf8");
  const packageJson = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { targets?: { sidebar?: { publicUrl?: string } } };

  it("uses relative classic-script assets that IINA can load", () => {
    expect(packageJson.targets?.sidebar?.publicUrl).toBe("./");
    expect(html).toContain('<script src="./provider-status.ts"></script>');
    expect(html).toContain('<script src="./sidebar.ts"></script>');
    expect(html).toContain('<script src="./sidebar-state.ts"></script>');
    expect(html).not.toContain('type="module"');
    expect(html.indexOf("./provider-status.ts")).toBeLessThan(html.indexOf("./sidebar.ts"));
    expect(html.indexOf("./sidebar-state.ts")).toBeLessThan(html.indexOf("./sidebar.ts"));
  });

  it("uses host-like native sidebar sections with two quiet grouped surfaces", () => {
    expect(html).not.toContain("IINA live translation");
    expect(html).toContain('<label class="setting-row">');
    expect(html).not.toContain('class="sidebar-header"');
    expect(html).toMatch(
      /<section class="sidebar-section"[^>]*>[\s\S]*?<div class="section-title-row">[\s\S]*?<h2 id="languages-heading">Subtitle<\/h2>[\s\S]*?<div class="translation-toggle">/,
    );
    expect(html.match(/class="sidebar-section/g)).toHaveLength(3);
    expect(html).not.toContain('class="card');
    expect(html).toContain('id="profiles" class="profiles group-surface"');
    expect(html).toContain('class="session-group group-surface"');
    expect(html.match(/group-surface/g)).toHaveLength(2);
    expect(sidebarCss).toMatch(/html,\s*body\s*{[\s\S]*?background: transparent/);
    expect(sidebarCss).toMatch(
      /\.sidebar-section\s*{[\s\S]*?width: 100%[\s\S]*?padding:[^;]*20px[\s\S]*?border-bottom: 1px solid var\(--separator\)/,
    );
    const sectionRule = sidebarCss.match(/\.sidebar-section\s*{[\s\S]*?\n}/)?.[0] ?? "";
    expect(sectionRule).not.toMatch(/border-radius|box-shadow|backdrop-filter|background:/);
    expect(sidebarCss).not.toContain(".card");
    expect(sidebarCss).toMatch(
      /\.group-surface\s*{[\s\S]*?border: 0[\s\S]*?border-radius: 10px[\s\S]*?background: var\(--group-surface\)/,
    );
    expect(sidebarCss).not.toContain("backdrop-filter");
    expect(sidebarCss).toContain(
      "--control-surface: color-mix(in srgb, CanvasText 7%, transparent)",
    );
    expect(sidebarCss).toMatch(
      /input,\s*select,\s*button\s*{[\s\S]*?min-height: 26px[\s\S]*?border: 0[\s\S]*?border-radius: 6px[\s\S]*?font-weight: 400[\s\S]*?background: var\(--control-surface\)[\s\S]*?box-shadow: none/,
    );
    const fieldRule = sidebarCss.match(/\.field\s*{[\s\S]*?\n}/)?.[0] ?? "";
    expect(fieldRule).toContain("display: grid");
    expect(fieldRule).toContain("gap: 5px");
    expect(sidebarCss).toMatch(/\.setting-row\s*{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
    expect(sidebarCss).toContain("--slider-track: color-mix(in srgb, CanvasText 32%, transparent)");
    expect(sidebarCss).toContain("--slider-track: color-mix(in srgb, CanvasText 48%, transparent)");
    expect(sidebarCss).toMatch(/\.switch input\s*{[\s\S]*?width: 44px[\s\S]*?height: 20px/);
    expect(sidebarCss).toMatch(
      /\.switch input::after\s*{[\s\S]*?top: 2px[\s\S]*?left: 2px[\s\S]*?width: 26px[\s\S]*?height: 16px[\s\S]*?border-radius: 8px/,
    );
    expect(sidebarCss).toMatch(
      /\.switch input:checked::after\s*{[\s\S]*?transform: translateX\(14px\)/,
    );
    expect(sidebarCss).toContain("--accent: #007aff");
    expect(sidebarCss).toContain("--accent: #0a84ff");
    expect(sidebarCss).not.toContain("#6d5dfc");
    expect(sidebarCss).toContain("@media (prefers-color-scheme: dark)");
    expect(sidebarCss).toContain("@media (prefers-contrast: more)");
    expect(sidebarCss).toContain("@media (prefers-reduced-transparency: reduce)");
    expect(sidebarCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(sidebarCss).toContain("@media (forced-colors: active)");
    expect(sidebarCss).toMatch(/@media \(max-width: 320px\)[\s\S]*?padding-inline: 14px/);
    expect(sidebarCss).toMatch(
      /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?--group-surface: var\(--group-surface-opaque\)/,
    );
  });

  it("offers all supported providers in fixed order and always exposes a required model ID", () => {
    expect(
      [...html.matchAll(/<option value="(openai|deepseek|ollama)">/g)].map((match) => match[1]),
    ).toEqual(["openai", "deepseek", "ollama"]);
    expect(html).toContain('<option value="deepseek">DeepSeek</option>');
    expect(html).toMatch(/id="provider-model"[\s\S]*?required/);
  });

  it("uses independent DeepSeek defaults without preselecting a model", () => {
    expect(sidebarSource).toContain(
      'deepseek: { endpoint: "https://api.deepseek.com", model: "", proxyMode: "system" }',
    );
    expect(sidebarSource).toContain('deepseek: "DeepSeek"');
    expect(sidebarSource).not.toMatch(/deepseek[^\n]+model:\s*"[^"]+"/i);
  });

  it("uses an accessible icon-only model refresh control", () => {
    const button = html.match(/<button[\s\S]*?id="refresh-models"[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(button).toContain('aria-label="Refresh model list"');
    expect(button).toContain('class="refresh-icon"');
    expect(button).not.toMatch(/>\s*Refresh\s*</);
    expect(html).toMatch(
      /id="model-catalog-status"[^>]*class="operation-status domain-status"[^>]*role="status"/,
    );
    expect(sidebarSource).toContain('setModelRefreshFeedback("busy")');
    expect(sidebarSource).not.toContain('setModelRefreshFeedback("busy", "Refreshing models…")');
    expect(sidebarSource).toContain("sidebarState.snapshot.modelControl.knownModelIds.length");
    expect(sidebarCss).toMatch(
      /\.domain-status\[data-state="success"\]\s*{[\s\S]*?color: var\(--label-secondary\)/,
    );
  });

  it("uses one accessible vertical write-only API key field for both services", () => {
    expect(html).toMatch(
      /id="credential-row"[\s\S]*?<span>API key<\/span>[\s\S]*?id="provider-key"[\s\S]*?aria-describedby="credential-hint"[\s\S]*?<small\s+id="credential-hint"[^>]*>/,
    );
    expect(html).not.toContain('id="credential-row" class="field" hidden');
    expect(sidebarSource).toContain(
      'document.querySelector<HTMLElement>("#credential-row")!.hidden = false',
    );
    expect(html).toContain('maxlength="8192"');
    expect(html).toMatch(/credential-hint[\s\S]*refresh/i);
  });

  it("uses entered credentials only for manual model preview and blocks empty-model saves", () => {
    expect(sidebarSource).toContain('"provider:models-preview"');
    expect(sidebarSource).toContain('trigger === "manual"');
    expect(sidebarSource).toContain("draftCredentialEpoch");
    expect(sidebarSource).toContain("Refresh models and choose one, or enter a custom model ID.");
    const saveStart = sidebarSource.indexOf('saveProfileButton.addEventListener("click"');
    const saveEnd = sidebarSource.indexOf('newProfileButton.addEventListener("click"', saveStart);
    const saveHandler = sidebarSource.slice(saveStart, saveEnd);
    expect(saveHandler.indexOf("if (!model)")).toBeLessThan(saveHandler.indexOf("beginOperation("));
  });

  it("uses the visible Service type as the savable default without a generic fallback", () => {
    expect(html).toContain('<option value="openai">OpenAI</option>');
    expect(html).toContain('id="profile-name" type="text" value="OpenAI"');
    expect(html).not.toContain("OpenAI-compatible");
    expect(sidebarSource).toContain("selectedServiceTypeLabel");
    expect(sidebarSource).toContain("inputProfileName");
    expect(sidebarSource).toContain("changeServiceTypeLabel");
    expect(sidebarSource).not.toContain('profileName.value.trim() || "Provider"');
  });

  it("offers profile editing and request-correlated feedback", () => {
    expect(html).not.toContain('id="operation-status"');
    expect(html).toContain('id="new-profile"');
    expect(html).toContain('id="request-url"');
    expect(html).toContain('id="provider-proxy-mode"');
    expect(html).toContain('<option value="direct">');
  });

  it("keeps local exception regions and one visually hidden operation announcer", () => {
    for (const [control, status] of [
      ['id="enabled"', 'id="translation-status"'],
      ['id="target-language"', 'id="language-status"'],
      ['class="form-actions"', 'id="profile-editor-status"'],
      ['id="retry-subtitle"', 'id="subtitle-retry-status"'],
    ]) {
      expect(html.indexOf(control)).toBeGreaterThan(-1);
      expect(html.indexOf(status)).toBeGreaterThan(html.indexOf(control));
    }
    for (const status of [
      "translation-status",
      "language-status",
      "profile-editor-status",
      "subtitle-retry-status",
    ])
      expect(html).toMatch(new RegExp(`id="${status}"[^>]*role="status"[^>]*aria-live="polite"`));
    expect(html).not.toMatch(/id="profiles"[^>]*aria-live/);
    expect(html).toMatch(
      /id="operation-announcer"[^>]*class="assistive-only"[^>]*role="status"[^>]*aria-live="polite"/,
    );
    expect(sidebarCss).toMatch(
      /\.assistive-only\s*{[\s\S]*?position: absolute[\s\S]*?clip-path: inset\(50%\)/,
    );
    expect(sidebarSource).toContain('className = "operation-status profile-operation-status"');
    expect(sidebarSource).toContain('feedback.visibility === "assistive"');
    expect(sidebarSource).not.toContain(".deleted-profile-result");
    expect(html).toMatch(
      /id="profile-editor-status"[^>]*role="status"[^>]*aria-live="polite"[^>]*>\s*<\/p>/,
    );
    expect(sidebarSource).not.toContain('profileEditorStatus.textContent = "Ready');
    expect(sidebarSource).not.toContain("profileEditorStatus.textContent = `Editing");
  });

  it("keeps selection consent separate from credential and connection verification", () => {
    expect(sidebarSource).toContain("Profile selected for translation.");
    expect(sidebarSource).not.toContain("Profile selected. Translation is authorized.");
    expect(sidebarSource).toContain("window.subtandemCredentialStatusMessage");
    expect(html).toContain("private local file (mode 0600)");
    expect(sidebarSource).toContain('type ProfileTestState = "not tested" | "passed" | "failed"');
    expect(sidebarSource).toContain('" · no key saved"');
    expect(sidebarSource).toContain('className = "profile-test-state"');
    expect(sidebarSource).toContain('passed: "Test passed"');
    expect(sidebarSource).toContain('failed: "Test failed"');
    expect(sidebarSource).not.toContain("` · ${profileTestStates");
  });

  it("exposes one catalog-driven Target Language control without source language input", () => {
    expect(html.match(/Target Language/g)).toHaveLength(1);
    expect(html).toMatch(
      /id="target-language"[^>]*aria-describedby="language-status"[^>]*disabled[^>]*>[\s\S]*?<\/select>\s*<\/label>\s*<p id="language-status"/,
    );
    expect(html).not.toContain('id="save-languages"');
    expect(html).not.toContain("Save Languages");
    expect(html).not.toMatch(/Mother language|Subtitle language|source-language/);
    expect(sidebarSource).toContain("view.targetLanguages");
    expect(sidebarSource).toContain("language.displayName");
  });

  it("auto-saves each changed target once with hydrated single-pending state", () => {
    const handlerStart = sidebarSource.indexOf('targetLanguage.addEventListener("change"');
    const handlerEnd = sidebarSource.indexOf(
      'translationPosition.addEventListener("input"',
      handlerStart,
    );
    const handlerSource = sidebarSource.slice(handlerStart, handlerEnd);

    expect(sidebarSource).toContain("committedTargetLanguage");
    expect(sidebarSource).toContain("targetLanguageHydrated");
    expect(sidebarSource).toContain("pendingLanguageSaveRequestId");
    expect(sidebarSource).not.toContain("targetLanguageDirty");
    expect(sidebarSource).not.toContain("saveLanguagesButton");
    expect(sidebarSource).toContain('if (actionId === "languages") return targetLanguage');
    expect(handlerSource).toContain("if (!targetLanguageHydrated || pendingLanguageSaveRequestId)");
    expect(handlerSource).toContain("targetLanguage.value === committedTargetLanguage");
    expect(handlerSource.match(/beginOperation\(/g)).toHaveLength(1);
    expect(handlerSource.match(/postMessage\(\s*"defaults:save"/g)).toHaveLength(1);
    expect(handlerSource).toContain("targetLanguageRevision");
    expect(sidebarSource).toContain('setAttribute("aria-busy", "true")');
    expect(sidebarSource).toContain("result.requestId === pendingLanguageSaveRequestId");
    expect(sidebarSource).not.toContain("sourceLanguageMode");
  });

  it("offers an accessible native position range in the Subtitle section", () => {
    expect(html).toContain('<h2 id="languages-heading">Subtitle</h2>');
    expect(html).toMatch(/<label[^>]*for="translation-position"[^>]*>\s*Position\s*<\/label>/);
    expect(html).toMatch(
      /id="translation-position"[^>]*type="range"[^>]*min="0"[^>]*max="100"[^>]*step="1"/,
    );
    expect(html).toMatch(
      /<output[^>]*id="translation-position-value"[^>]*for="translation-position"/,
    );
    expect(html).toMatch(
      /id="translation-position-status"[^>]*role="status"[^>]*aria-live="polite"/,
    );
    expect(sidebarSource).toContain('translationPosition.setAttribute("aria-busy"');
    expect(sidebarSource).toMatch(
      /translationPositionStatus\.classList\.toggle\(\s*"assistive-only"/,
    );
    expect(html).not.toMatch(/>\s*Save Translation Position\s*</i);
    expect(sidebarSource).toContain('translationPosition.addEventListener("input"');
    expect(sidebarSource).toContain('translationPosition.addEventListener("change"');
  });

  it("matches the IINA tickless position slider geometry", () => {
    const rangeRule = sidebarCss.match(/#translation-position\s*{[\s\S]*?\n}/)?.[0] ?? "";
    const trackRule =
      sidebarCss.match(
        /#translation-position::-webkit-slider-runnable-track\s*{[\s\S]*?\n}/,
      )?.[0] ?? "";
    const thumbRule =
      sidebarCss.match(/#translation-position::-webkit-slider-thumb\s*{[\s\S]*?\n}/)?.[0] ?? "";

    expect(rangeRule).toContain("appearance: none");
    expect(rangeRule).toContain("height: 20px");
    expect(rangeRule).toContain("padding: 0");
    expect(trackRule).toContain("height: 3px");
    expect(trackRule).toContain("border-radius: 1.5px");
    expect(trackRule).toContain("background: var(--slider-track)");
    expect(thumbRule).toContain("appearance: none");
    expect(thumbRule).toContain("width: 18px");
    expect(thumbRule).toContain("height: 14px");
    expect(thumbRule).toContain("margin-top: -5.5px");
    expect(thumbRule).toContain("border: 0");
    expect(thumbRule).toContain("border-radius: 7px");
    expect(thumbRule).toContain("background: var(--slider-thumb)");
    expect(thumbRule).toContain("box-shadow: none");
    expect(sidebarCss).toContain("--slider-thumb: #e2e2e2");
    expect(sidebarCss).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?#translation-position\s*{[\s\S]*?appearance: auto/,
    );
  });

  it("commits trackpad-only drags once from window-level completion signals", () => {
    expect(sidebarSource).toContain("completeOverlayPositionInteraction");
    for (const eventName of ["pointerup", "pointercancel", "mouseup", "touchend"])
      expect(sidebarSource).toContain(`window.addEventListener("${eventName}"`);
    expect(sidebarSource).not.toContain("setTimeout(completeOverlayPositionInteraction");
  });
});
