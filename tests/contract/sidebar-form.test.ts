import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("IINA sidebar bundle contract", () => {
  const html = readFileSync(new URL("../../ui/sidebar.html", import.meta.url), "utf8");
  const sidebarCss = readFileSync(new URL("../../ui/sidebar.css", import.meta.url), "utf8");
  const sidebarSource = readFileSync(new URL("../../ui/sidebar.ts", import.meta.url), "utf8");
  const mainSource = readFileSync(new URL("../../src/main.ts", import.meta.url), "utf8");
  const sessionStatusSource = readFileSync(
    new URL("../../ui/session-status.ts", import.meta.url),
    "utf8",
  );
  const serviceFailurePath = new URL("../../ui/service-failure-message.ts", import.meta.url);
  const serviceFailureSource = existsSync(serviceFailurePath)
    ? readFileSync(serviceFailurePath, "utf8")
    : "";
  const providerStatusSource = readFileSync(
    new URL("../../ui/provider-status.ts", import.meta.url),
    "utf8",
  );
  const packageJson = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { targets?: { sidebar?: { publicUrl?: string } } };

  it("places a single hidden editor drawer inside the grouped Profile list", () => {
    const heading = html.indexOf('id="provider-heading"');
    const create = html.indexOf('id="new-profile"');
    const profiles = html.indexOf('id="profiles"');
    const drawer = html.indexOf('id="profile-drawer"');
    expect(heading).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(heading);
    expect(create).toBeLessThan(profiles);
    expect(drawer).toBeGreaterThan(profiles);
    expect(html).toMatch(/id="profiles" class="profiles group-surface"/);
    expect(html).toMatch(/id="profile-drawer"[^>]*hidden/);
    expect(html.match(/id="profile-drawer"/g)).toHaveLength(1);
  });

  it("uses Disclosure semantics and never renders saved Test state in summaries", () => {
    expect(sidebarSource).toContain('className = "profile-disclosure"');
    expect(sidebarSource).toContain('setAttribute("aria-expanded"');
    expect(sidebarSource).toContain('setAttribute("aria-controls"');
    expect(sidebarSource).toContain("`Edit ${profile.displayName}`");
    expect(sidebarSource).not.toContain('className = "profile-test-state"');
    expect(sidebarSource).not.toContain('passed: "Test passed"');
    expect(sidebarSource).not.toContain('failed: "Test failed"');
  });

  it("uses relative classic-script assets that IINA can load", () => {
    expect(packageJson.targets?.sidebar?.publicUrl).toBe("./");
    expect(html).toContain('<script src="./provider-status.ts"></script>');
    expect(html).toContain('<script src="./sidebar.ts"></script>');
    expect(html).toContain('<script src="./sidebar-state.ts"></script>');
    expect(html).not.toContain('type="module"');
    expect(html.indexOf("./provider-status.ts")).toBeLessThan(html.indexOf("./sidebar.ts"));
    expect(html.indexOf("./sidebar-state.ts")).toBeLessThan(html.indexOf("./sidebar.ts"));
  });

  it("loads one shared service failure mapper before both feedback consumers", () => {
    expect(serviceFailureSource).not.toBe("");
    expect(html).toContain('<script src="./service-failure-message.ts"></script>');
    expect(html.indexOf("./service-failure-message.ts")).toBeLessThan(
      html.indexOf("./provider-status.ts"),
    );
    expect(html.indexOf("./service-failure-message.ts")).toBeLessThan(
      html.indexOf("./session-status.ts"),
    );
    for (const consumer of [providerStatusSource, sessionStatusSource]) {
      expect(consumer).toContain("subtandemServiceFailureMessage");
      expect(consumer).not.toContain("Authentication failed. Check the Profile’s API key.");
      expect(consumer).not.toContain(
        "The service limit was reached. Check the account quota or try again later.",
      );
      expect(consumer).not.toContain("Translation failed. Test the Profile and try again.");
    }
  });

  it("renders each Profile activation as a confirmed accessible switch", () => {
    expect(sidebarSource).toContain('role = "switch"');
    expect(sidebarSource).toContain("`Enable ${profile.displayName}`");
    expect(sidebarSource).toMatch(/postMessage\(\s*"profile-activation:set"/);
    expect(sidebarSource).not.toContain('postMessage("profile:select"');
    expect(sidebarSource).not.toMatch(/\["select",[^\]]+\]/i);
  });

  it("uses the non-control Profile content as the pointer and keyboard edit entry", () => {
    expect(sidebarSource).toContain("new ProfileCardInteractionCoordinator");
    expect(sidebarSource).toContain("tabIndex = 0");
    expect(sidebarSource).toContain("`Edit ${profile.displayName}`");
    expect(sidebarSource).toContain("openProfileDrawer");
    expect(sidebarSource).toContain("mountProfileDrawer");
    expect(sidebarSource).not.toMatch(/\["edit",\s*"Edit"\]/);
    expect(sidebarSource).toContain('article.classList.toggle("is-editing", expanded)');
  });

  it("provides a local accessible delete confirmation and one stable Test label", () => {
    expect(html).toMatch(
      /id="profile-delete-dialog"[\s\S]*?role="alertdialog"[\s\S]*?aria-modal="true"/,
    );
    expect(html).toContain('aria-labelledby="profile-delete-title"');
    expect(html).toMatch(/aria-describedby="profile-delete-description(?: [^"]+)?"/);
    expect(html).toMatch(/class="profile-delete-icon"[^>]*aria-hidden="true"/);
    expect(html.indexOf('id="confirm-profile-delete"')).toBeLessThan(
      html.indexOf('id="cancel-profile-delete"'),
    );
    expect(html).toMatch(
      /<button[^>]*id="test-profile"[^>]*aria-describedby="profile-test-status"[^>]*>\s*Test\s*<\/button>/,
    );
    expect(html).not.toContain("profile-action-placeholder");
    expect(sidebarSource.match(/Testing…/g)).toHaveLength(1);
    expect(sidebarSource).not.toContain("Testing the current draft");
    expect(sidebarSource).toContain("Deleting…");
    expect(sidebarSource).toContain('"The profile will be permanently deleted."');
    expect(sidebarCss).not.toContain(".profile-action-placeholder");
    expect(`${html}\n${sidebarSource}\n${sidebarCss}`).not.toMatch(
      /busy-ring|spinner|test-profile[^\n{]*::(?:before|after)|profile-test[^\n{]*animation/i,
    );
  });

  it("centers both Profile actions in fixed-height slots with a destructive filled Delete", () => {
    const actionRule = sidebarCss.match(/\.profile-drawer-actions button\s*{[^}]+}/)?.[0] ?? "";
    expect(actionRule).toContain("display: grid");
    expect(actionRule).toContain("place-items: center");
    expect(actionRule).toMatch(/\n\s*height: 26px;/);
    expect(actionRule).toContain("line-height: 14px");
    expect(actionRule).toContain("white-space: nowrap");
    expect(sidebarCss).not.toMatch(/\.profile span\s*[,{]/);
    expect(sidebarCss).not.toContain(".profile-action-label");
    expect(sidebarCss).not.toContain(".profile-action-placeholder");
    expect(sidebarCss).toMatch(
      /\.profile-drawer-actions \.danger\s*{[^}]*color: white;[^}]*background: var\(--destructive-fill\)/,
    );
  });

  it("does not add an emphasized surface when a Profile drawer is expanded", () => {
    expect(sidebarSource).toContain('article.classList.toggle("is-editing", expanded)');
    expect(sidebarCss).not.toContain("--profile-selection-strength");
    expect(sidebarCss).not.toContain("--profile-selection-surface");
    expect(sidebarCss).not.toMatch(/\.profile\.is-editing\s*{/);
    expect(sidebarCss).not.toMatch(/\.profile\.is-editing \+ \.profile\s*{/);
    expect(sidebarCss).toMatch(/@media \(prefers-reduced-transparency: reduce\)/);
    expect(sidebarCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("groups Profiles and session status on native sidebar surfaces", () => {
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
    const profilesRule = sidebarCss.match(/\.profiles\s*{[^}]+}/)?.[0] ?? "";
    expect(profilesRule).toContain("min-width: 0");
    expect(profilesRule).not.toMatch(/background|border|box-shadow/);
    const profileRule = sidebarCss.match(/\.profile\s*{[^}]+}/)?.[0] ?? "";
    expect(profileRule).toContain("background: transparent");
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
    expect(sidebarCss).toContain("--accent: #3e92fc");
    expect(sidebarCss).toContain("--accent: #3e7ce6");
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
      [...html.matchAll(/<option value="(openai|claude|deepseek|ollama)">/g)].map(
        (match) => match[1],
      ),
    ).toEqual(["openai", "claude", "deepseek", "ollama"]);
    expect(html).toContain('<option value="claude">Claude</option>');
    expect(html).toContain('<option value="deepseek">DeepSeek</option>');
    expect(html).toMatch(/id="provider-model"[\s\S]*?required/);
  });

  it("uses Claude defaults, Messages URL guidance, Custom ID and a required API key", () => {
    expect(sidebarSource).toContain(
      'claude: { endpoint: "https://api.anthropic.com", model: "", proxyMode: "direct" }',
    );
    expect(sidebarSource).toContain('claude: "Claude"');
    expect(sidebarSource).not.toMatch(/claude[^\n]+model:\s*"[^"]+"/i);
    expect(sidebarSource).toContain("/v1/messages");
    expect(sidebarSource).toMatch(/Claude[\s\S]*API root/i);
    expect(sidebarSource).toMatch(/exact Claude model ID/i);
    expect(sidebarSource).toContain('custom.textContent = "Custom model ID…"');
    expect(html).toMatch(/id="provider-key"[\s\S]*?type="password"/);
    expect(sidebarSource).toContain("claudeCredentialRequired");
    expect(sidebarSource).toContain("Enter an API key before saving this Claude Profile.");
  });

  it("uses independent DeepSeek defaults without preselecting a model", () => {
    expect(sidebarSource).toContain(
      'deepseek: { endpoint: "https://api.deepseek.com", model: "", proxyMode: "direct" }',
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
    expect(saveHandler).toContain("sidebarState.modelForSave()");
    expect(sidebarSource).toContain("bindSubTandemModelControls");
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
    expect(html).toContain('<option value="direct" selected>');
  });

  it("uses direct for every new service draft and explains both route choices", () => {
    for (const kind of ["openai", "claude", "deepseek", "ollama"])
      expect(sidebarSource).toMatch(
        new RegExp(`${kind}: \\{ endpoint: [^\\n]+proxyMode: "direct" \\}`),
      );
    expect(html).toMatch(
      /<option value="direct" selected>Connect directly<\/option>[\s\S]*?<option value="system">Use macOS proxy settings<\/option>/,
    );
    expect(html).toMatch(
      /Connect directly without the macOS proxy, or use the current macOS proxy\s+settings\./,
    );
    expect(html).not.toMatch(/fallback|falls back/i);
  });

  it("keeps Test feedback together and splits Delete from the right-side save actions", () => {
    const actions =
      html.match(/<div class="profile-drawer-actions">[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
    const testRow = actions.indexOf('class="profile-drawer-test-row"');
    const test = actions.indexOf('id="test-profile"');
    const testStatus = actions.indexOf('id="profile-test-status"');
    const commitRow = actions.indexOf('class="profile-drawer-commit-row"');
    const remove = actions.indexOf('id="delete-profile"');
    const endGroup = actions.indexOf('class="profile-drawer-actions-end"');
    const cancel = actions.indexOf('id="cancel-profile"');
    const save = actions.indexOf('id="save-profile"');
    expect(testRow).toBeGreaterThan(-1);
    expect(test).toBeGreaterThan(testRow);
    expect(testStatus).toBeGreaterThan(test);
    expect(commitRow).toBeGreaterThan(testStatus);
    expect(remove).toBeGreaterThan(commitRow);
    expect(endGroup).toBeGreaterThan(remove);
    expect(cancel).toBeGreaterThan(endGroup);
    expect(save).toBeGreaterThan(cancel);
    expect(sidebarCss).toMatch(/\.profile-drawer-actions\s*{[^}]*display: grid;[^}]*row-gap: 12px/);
    expect(sidebarCss).toMatch(
      /\.profile-drawer-test-row\s*{[^}]*display: flex;[^}]*align-items: center;[^}]*flex-wrap: wrap/,
    );
    expect(sidebarCss).toMatch(
      /\.profile-drawer-test-row \.operation-status\s*{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere/,
    );
    expect(sidebarCss).toMatch(
      /\.profile-drawer-commit-row\s*{[^}]*display: flex;[^}]*justify-content: space-between;[^}]*flex-wrap: wrap/,
    );
    expect(sidebarCss).toMatch(
      /\.profile-drawer-actions-end\s*{[^}]*margin-left: auto;[^}]*justify-content: flex-end/,
    );
  });

  it("keeps local exception regions and one visually hidden operation announcer", () => {
    for (const [control, status] of [
      ['id="enabled"', 'id="translation-status"'],
      ['id="target-language"', 'id="language-status"'],
      ['class="profile-drawer-actions"', 'id="profile-editor-status"'],
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
    expect(sidebarSource).toContain('class="operation-status profile-operation-status"');
    expect(sidebarSource).toContain('feedback.visibility === "assistive"');
    expect(sidebarSource).not.toContain(".deleted-profile-result");
    expect(html).toMatch(
      /id="profile-editor-status"[^>]*role="status"[^>]*aria-live="polite"[^>]*>\s*<\/p>/,
    );
    expect(sidebarSource).not.toContain('profileEditorStatus.textContent = "Ready');
    expect(sidebarSource).not.toContain("profileEditorStatus.textContent = `Editing");
  });

  it("keeps activation separate from drawer-only credential and connection verification", () => {
    expect(sidebarSource).toMatch(/postMessage\(\s*"profile-activation:set"/);
    expect(sidebarSource).not.toContain("Profile selected for translation.");
    expect(sidebarSource).toContain("window.subtandemCredentialStatusMessage");
    expect(html).toContain("private local file (mode 0600)");
    expect(sidebarSource).toContain('" · no key saved"');
    expect(html).toContain('id="profile-test-status"');
    expect(sidebarSource).toContain('postMessage(\n    "provider:test"');
    expect(sidebarSource).not.toContain('className = "profile-test-state"');
    expect(sidebarSource).not.toContain("profileTestStates");
  });

  it("keeps one non-focusable live region for Session and Profile Test feedback", () => {
    const sessionFeedback =
      html.match(/<p id="status"[^>]*role="status"[^>]*aria-live="polite"[^>]*>/g) ?? [];
    const testFeedback =
      html.match(/<p\s+id="profile-test-status"[^>]*role="status"[^>]*aria-live="polite"[^>]*>/g) ??
      [];

    expect(sessionFeedback).toHaveLength(1);
    expect(testFeedback).toHaveLength(1);
    expect(sessionFeedback[0]).not.toMatch(/hidden|assistive-only|tabindex/);
    expect(testFeedback[0]).not.toMatch(/hidden|assistive-only|tabindex/);
    expect(html.match(/id="status"/g)).toHaveLength(1);
    expect(html.match(/id="profile-test-status"/g)).toHaveLength(1);
    expect(html.match(/aria-describedby="profile-test-status"/g)).toHaveLength(1);
    expect(html).not.toMatch(
      /(?:hidden|assistive-only|tabindex="0")[^>]*>[^<]*(?:Translation failed|Authentication failed|translation service|subtitle type not supported)/i,
    );
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

  it("shows source and actionable session details without local language detection", () => {
    expect(html).toContain('id="source-format"');
    expect(html).toContain('id="source-cues"');
    expect(sidebarSource).toContain("sourceDetails.source.format");
    expect(sidebarSource).toContain("sourceDetails.source.cueCount");
    expect(sessionStatusSource).toContain("sessionSourcePreparationLabels");
    expect(sessionStatusSource).toContain("serviceUnavailable");
    expect(`${html}\n${sidebarSource}`).not.toMatch(
      /Detected language|source-detected-language|\bUnknown\b|detectingLanguage|languageUnrecognized|languageUnsupported|noTranslationNeeded/,
    );
  });

  it("omits the obsolete Work bound summary from the Session surface", () => {
    expect(html).not.toContain("Work bound");
    expect(html).not.toContain('id="work-bound"');
    expect(sidebarSource).not.toContain("boundedWork");
    expect(mainSource).not.toContain("boundedWork");
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

describe("Subtitle Font controls contract", () => {
  const html = readFileSync(new URL("../../ui/sidebar.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../ui/sidebar.css", import.meta.url), "utf8");

  it("places the Font group immediately after Position with all five fields", () => {
    const position = html.indexOf('id="translation-position"');
    const font = html.indexOf('id="subtitle-font-group"');
    const service = html.indexOf('id="provider-heading"');
    expect(position).toBeGreaterThan(-1);
    expect(font).toBeGreaterThan(position);
    expect(font).toBeLessThan(service);
    expect(html).toContain('id="subtitle-font-color"');
    expect(html).toContain('id="subtitle-font-size"');
    expect(html).toContain('id="subtitle-font-family"');
    expect(html).toMatch(/id="subtitle-font-bold"[^>]*type="checkbox"/);
    expect(html).toMatch(/id="subtitle-font-italic"[^>]*type="checkbox"/);
  });

  it("uses the finite Size choices, an accessible font button and named color trigger", () => {
    const size = html.match(/<select id="subtitle-font-size"[\s\S]*?<\/select>/)?.[0] ?? "";
    expect([...size.matchAll(/<option value="([^"]+)"/g)].map((match) => Number(match[1]))).toEqual(
      [30, 35, 40, 45, 50, 55, 60, 65, 70],
    );
    expect(html).toMatch(
      /<button[^>]*id="subtitle-font-family"[^>]*aria-describedby="subtitle-font-status"/,
    );
    expect(html).toMatch(
      /<button[^>]*id="subtitle-font-color"[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"/,
    );
    expect(html).toContain('id="subtitle-color-palette"');
    expect(html).toMatch(/data-color-name="White"/);
    expect(html).toMatch(/data-color-name="Black"/);
  });

  it("provides narrow-column, focus and high-contrast styling", () => {
    expect(css).toContain(".subtitle-style-group");
    expect(css).toContain(".subtitle-color-trigger");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("@media (prefers-contrast: more)");
  });

  it("matches the compact IINA text-style hierarchy without outlined fieldset cards", () => {
    const position = html.indexOf('id="translation-position"');
    const heading = html.indexOf('id="subtitle-style-heading"');
    const surface = html.indexOf('class="subtitle-style-surface"');
    const groupRule = css.match(/\.subtitle-style-group\s*\{[\s\S]*?\n}/)?.[0] ?? "";
    const fontFieldsRule = css.match(/\.subtitle-style-font-fields\s*\{[\s\S]*?\n}/)?.[0] ?? "";
    const borderFieldsRule = css.match(/\.subtitle-style-border-fields\s*\{[\s\S]*?\n}/)?.[0] ?? "";
    const triggerRule = css.match(/\.subtitle-color-trigger\s*\{[\s\S]*?\n}/)?.[0] ?? "";
    expect(heading).toBeGreaterThan(position);
    expect(surface).toBeGreaterThan(heading);
    expect(html).toContain('class="subtitle-style-fields subtitle-style-font-fields"');
    expect(html).toContain('class="subtitle-style-fields subtitle-style-border-fields"');
    expect(groupRule).toContain("border: 0");
    expect(fontFieldsRule).toContain(
      "grid-template-columns: max-content max-content minmax(0, 1fr)",
    );
    expect(borderFieldsRule).toContain("grid-template-columns: max-content max-content");
    expect(triggerRule).toContain("background: transparent");
    expect(triggerRule).not.toContain("background: var(--accent)");
  });

  it("matches the measured 28 by 21 point IINA color wells without truncated text", () => {
    const triggers = [
      ...html.matchAll(/<button[\s\S]*?class="subtitle-color-trigger"[\s\S]*?<\/button>/g),
    ];
    const triggerRule = css.match(/\.subtitle-color-trigger\s*\{[\s\S]*?\n}/)?.[0] ?? "";
    const swatchRule = css.match(/\.subtitle-color-swatch\s*\{[\s\S]*?\n}/)?.[0] ?? "";
    expect(triggers).toHaveLength(3);
    expect(triggers.every(([trigger]) => trigger.includes('class="subtitle-color-swatch"'))).toBe(
      true,
    );
    expect(triggers.every(([trigger]) => trigger.includes('aria-label="'))).toBe(true);
    expect(html).not.toContain("subtitle-color-value");
    expect(triggerRule).toContain("width: 28px");
    expect(triggerRule).toContain("min-width: 28px");
    expect(triggerRule).toContain("height: 21px");
    expect(triggerRule).toContain("min-height: 21px");
    expect(triggerRule).toContain("border-radius: 10.5px");
    expect(triggerRule).toContain("padding: 0");
    expect(triggerRule).toContain("overflow: hidden");
    expect(swatchRule).toContain("display: block");
    expect(swatchRule).toContain("border-radius: 10.5px");
    expect(swatchRule).toContain("width: 100%");
    expect(swatchRule).toContain("linear-gradient(var(--subtitle-swatch), var(--subtitle-swatch))");
    expect(swatchRule).toContain("repeating-conic-gradient");
  });
});

describe("Subtitle Border and Background controls contract", () => {
  const html = readFileSync(new URL("../../ui/sidebar.html", import.meta.url), "utf8");

  it("places Border and Background after Font and before the service section", () => {
    const font = html.indexOf('id="subtitle-font-group"');
    const border = html.indexOf('id="subtitle-border-group"');
    const background = html.indexOf('id="subtitle-background-group"');
    const service = html.indexOf('id="provider-heading"');
    expect(font).toBeGreaterThan(-1);
    expect(border).toBeGreaterThan(font);
    expect(background).toBeGreaterThan(border);
    expect(service).toBeGreaterThan(background);
  });

  it("exposes two named color triggers and the exact finite Width choices", () => {
    expect(html).toMatch(
      /<button[^>]*id="subtitle-border-color"[^>]*aria-haspopup="dialog"[^>]*aria-controls="subtitle-color-palette"/,
    );
    expect(html).toMatch(
      /<button[^>]*id="subtitle-background-color"[^>]*aria-haspopup="dialog"[^>]*aria-controls="subtitle-color-palette"/,
    );
    const width = html.match(/<select id="subtitle-border-width"[\s\S]*?<\/select>/)?.[0] ?? "";
    expect(
      [...width.matchAll(/<option value="([^"]+)"/g)].map((match) => Number(match[1])),
    ).toEqual([0, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5]);
    expect(html.match(/id="subtitle-color-palette"/g)).toHaveLength(1);
  });
});

describe("Shared subtitle color palette contract", () => {
  const html = readFileSync(new URL("../../ui/sidebar.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../ui/sidebar.css", import.meta.url), "utf8");

  it("offers named RGBA presets, selected semantics and one Show Colors entry", () => {
    const paletteStart = html.indexOf('id="subtitle-color-palette"');
    const paletteEnd = html.indexOf('id="subtitle-style-error"', paletteStart);
    const palette = html.slice(paletteStart, paletteEnd);
    expect(palette).toContain('data-color-name="White"');
    expect(palette).toContain('data-color-name="Black"');
    expect(palette).toContain('data-color-name="Transparent"');
    expect(palette).toContain('aria-checked="false"');
    expect(palette).toContain('id="subtitle-show-colors"');
    expect(palette).toContain("Show Colors…");
    expect(html.match(/id="subtitle-show-colors"/g)).toHaveLength(1);
  });

  it("styles alpha swatches, selected state, keyboard focus and high contrast", () => {
    expect(css).toContain(".palette-swatch");
    expect(css).toContain('.subtitle-color-palette button[aria-checked="true"]');
    expect(html).toContain('class="subtitle-color-grid"');
    expect(css).toMatch(/\.subtitle-color-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(10,/);
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("@media (prefers-contrast: more)");
  });
});
