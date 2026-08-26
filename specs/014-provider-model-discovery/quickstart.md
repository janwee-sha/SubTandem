# 快速验证：服务模型发现与凭据扩展

## 前置条件

- macOS 12+、Node.js 24.18.0、npm 11、Swift 6.0，依赖已按 lock 安装。
- IINA 1.4.4 与 `iina-plugin` CLI。
- 为 OpenAI 与 Ollama 准备可控模型列表服务；Ollama 至少包含无需认证、正确 Key、缺失 Key 和错误 Key 场景。
- 真实服务配置只能从 `docs/providers` 本地读取，不得复制到规格、任务、日志、命令输出或验收证据。

## 聚焦自动化

```sh
npx vitest run \
  tests/contract/provider-model-discovery.test.ts \
  tests/contract/openai.test.ts \
  tests/contract/ollama.test.ts \
  tests/contract/provider-profiles.test.ts \
  tests/contract/credential-store.test.ts \
  tests/contract/global-rpc.test.ts \
  tests/contract/sidebar-form.test.ts \
  tests/contract/sidebar-lifecycle.test.ts \
  tests/contract/ui-messages.test.ts \
  tests/contract/package-manifest.test.ts \
  tests/unit/model-catalog-sync.test.ts \
  tests/unit/sidebar-state.test.ts \
  tests/integration/us3-providers.test.ts \
  tests/integration/provider-connection-lifecycle.test.ts \
  tests/security/credential-leakage.test.ts \
  tests/security/redaction.test.ts
npm run test:native
```

预期：

- OpenAI 只请求 `{API Root}/models`，展示全部有效 `data[].id` 且不按 `owned_by` 筛选；Ollama 只请求 `{server root}/api/tags`，使用 `model`、必要时回退 `name`。
- 两种响应均正确处理空白、重复、大小写、标点、空目录和畸形结构；失败保留旧目录，成功空目录清空已知项。
- IINA 启动、Sidebar 打开、稳定 Endpoint 和手动四类触发均被生产状态机覆盖；手动请求、Profile/revision/route/credential 变化和多窗口竞态均 latest-only。
- Ollama 的 version、tags、chat 在有 Key 时使用同一 Bearer，无 Key 时不发送 Authorization；凭据替换和删除清理旧任务与 cache。
- Ollama Test 与翻译不发送 `think`；支持 JSON Schema 的 Endpoint 使用结构化输出，不支持该能力的远程原生 API 使用 prompt-only JSON，并仍拒绝额外自然语言或错误 ID。
- 新建带凭据 Profile 后立即显示 Profile 行；凭据触发的模型刷新取代保存前已取消请求并最终结束 busy。
- 新建认证 Profile 可在保存前填写 Key 并手动刷新模型；自动刷新不发送该输入，草稿结果不跨 Key 代次、请求或窗口复用，选择模型后完整 Profile 与凭据才进入既有保存流程。
- Model ID 为空时 Save 在 Sidebar 本地停止，并提示刷新选择模型或输入 Custom Model ID，不创建半成品 Profile。
- 刷新消息、Profile view、反馈、日志、preferences 和包不含 API Key、Authorization、原始响应、完整 Endpoint、字幕、译文或播放位置。
- 刷新不修改 Model ID、不 Select、不创建 lease、不授权或触发翻译。

## 完整门禁与候选包

严格依次运行：

```sh
npm test
npm run typecheck
npm run lint
npm run build:native
npm run test:native
npm run build
npm run verify:package
npm run pack
```

预期：全部命令通过，0.1.0 manifest 身份保持一致；正式包仍只包含白名单材料和两个受支持架构的 helper，不含凭据、运行目录、源码、测试或 SDD。本流程不 commit、tag、上传或发布。

## 当前文档与披露复核

人工核对根 README、全部 `docs/readme/README.*.md`、`docs/engineering/development.md` 和 `Info.json`：

- 当前用户可见服务名为 OpenAI，不回写历史 release notes 或既有验收证据；
- OpenAI 仍说明可使用兼容 API 契约的自定义 HTTP(S) Endpoint；
- 两种 Profile 均说明可选只写 API Key 和模型列表/自定义 Model ID；
- 网络披露明确区分“Select 前不含字幕的模型目录请求”和“Select 后的字幕翻译请求”；
- `permissions` 与 `allowedDomains: ["127.0.0.1"]` 不变。

项目宪法禁止用只断言文档文案或结构的自动化测试替代该复核。

## IINA 1.4.4 正式包验收

使用同一个候选 `.iinaplgz`，记录包 SHA-256、macOS、架构、IINA 版本和每项结果；不得记录 Endpoint、Key、Authorization、字幕、译文或响应正文。

1. 预先保存可访问的 OpenAI 与 Ollama Profile，重启 IINA 并立即播放，确认启动刷新不阻塞播放；打开 Sidebar 后看到对应服务目录。
2. 关闭并重新打开 Sidebar，确认当前上下文刷新；快速输入 Endpoint A→B、切换 Service/Profile/route，只有稳定且当前的上下文可见；手动刷新立即取代重叠自动请求。
3. 分别返回多模型、重复/空/缺 ID、零有效、畸形、超时和不可达结果；目录与清洗规则正确，失败保留上次成功目录、当前 Model ID 和 Custom。
4. 分别选择已知、自定义和刷新后消失的模型，完成 Save、重新编辑、Test、Select 与实际字幕翻译；精确 ID 保持不变，刷新本身不改变选择或发送字幕。
5. 载入升级前 OpenAI Profile，确认 Service type 标签更新为 OpenAI、已保存 Profile 名称不被改写，既有 Endpoint、Model ID、凭据状态、网络路线和翻译行为不变；自定义 HTTP(S) API Root 仍可完整工作。
6. 对远程认证 Ollama 分别使用正确、缺失和错误 Key 验证 Refresh、Test 与翻译；无需认证的 Ollama 在空 Key 下仍成功。编辑不回显 Key，替换后旧响应无效，删除只清理目标 Profile。
7. 分别打开 OpenAI 与 Ollama 编辑器，确认 `API key` 主标签、输入框和只写/可选说明按纵向分行显示，说明通过辅助技术与输入框关联；宽窄 Sidebar 下均不得退化为标签内联说明。
8. 在 system/direct 与两个窗口中交错自动、手动刷新，确认目录不跨 Endpoint、Profile 或窗口污染，旧结果不覆盖较新结果。
9. 用 sentinel 检查 IINA Log Viewer、`iina.log`、`mpv.log`、preferences、诊断与候选包；敏感内容命中为 0。最后确认安装项可卸载。

只有实际完成后，才可在 `docs/validation/iina-matrix.md` 记录 014 的正式包证据；开发链接和自动化不得替代。
