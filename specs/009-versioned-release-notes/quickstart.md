# 验证指南：版本化用户发布说明

## 前置条件

- Node.js 24、npm 11，并已执行 `npm ci`。
- 当前项目版本为稳定 `X.Y.Z`，仓库存在对应的 `docs/releases/vX.Y.Z.md`。
- 发布说明的目标版本和规格来源已经由用户明确；本指南不创建或修改远端 Release。

## 聚焦自动化

```sh
npm run test:release
```

预期覆盖：

- 元数据、审计和发布阶段保持权威路径与原始摘要的安全传递，技术证据仍完整且与用户正文分离。
- draft 正文匹配时恢复；公开正文匹配时只读跳过；任一正文偏差都冲突失败且不覆盖。
- workflow 继续保持八项门禁、只读构建/可写发布边界、四项公开资产和禁止仓库回写。

版本化正文由发布脚本在运行时校验，不为 Markdown 内容维护专门的自动化测试套件。

## 元数据验收

```sh
node scripts/release-metadata.mjs
```

预期：输出的 `version`、`tag`、`artifactPath`、`releaseNotesPath` 和 `releaseNotesSha256` 相互一致。

## 完整本地回归

```sh
npm run test
npm run typecheck
npm run lint
npm run format:check
```

需要验证完整正式包时，继续按 [自动 GitHub Release 验证指南](../004-automatic-github-release/quickstart.md) 依次运行八项发布门禁和最终归档审计。审计完成后确认：

1. `build/release/release-notes.md` 与对应 `docs/releases/vX.Y.Z.md` 原始摘要一致。
2. `release-audit.json` 包含正文源路径、摘要、全部既有技术证据和三项宿主未覆盖状态。
3. 用户正文不包含技术审计字段；公开资产白名单仍为既有四项。
4. Actions 摘要和日志可独立核对技术证据，workflow 没有生成、修改、commit 或 push 仓库文档。

## 发布说明单人验收

由开发者按用户指定规格逐条核对：

1. 每个条目都能映射到至少一项已实现并验收的用户故事、需求或兼容边界。
2. 没有遗漏指定范围中的已验收用户变化，也没有写入未指定、未实现或未验收内容。
3. 内部重构、测试、构建、依赖和审计工作没有被包装为用户功能。
4. 无需查看源码或日志，可以在 2 分钟内列出本版本变化和全部升级兼容提醒。

任一项不满足时停止发布准备，修正规格范围、交付状态或发布说明后重新验收。

## SDD 与稳定文档一致性

实施完成后检查非任务产物中不再保留冲突的当前要求：

```sh
rg -n 'Release 正文.*技术|自动生成的 Release 说明|自愿支持段落|正文来自最终归档审计' specs/004-automatic-github-release specs/006-sponsor-entry docs/validation -g '!tasks.md'
git diff --check
```

预期：搜索不命中正文生成、技术证据正文或 Release 打赏段落要求；004 的门禁、资产、权限和生命周期仍保留，006 的 README 与 Sponsor 入口保持冻结，005 只描述 v0.1.0 首版合规发布。

## 远端边界

聚焦测试使用纯状态输入或模拟 GitHub CLI，不产生远端写入。实际创建或恢复 Release 属于后续发布操作，只有用户明确提供目标版本、对应规格并授权发布时才能执行。
