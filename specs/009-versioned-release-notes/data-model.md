# 数据模型：版本化用户发布说明

本功能不新增插件运行时或用户持久化数据。以下实体存在于发布准备、版本控制、GitHub Actions 运行和 GitHub Release 服务中。

## VersionReleaseScope

- `version`：用户明确指定的稳定版本 `X.Y.Z`。
- `tag`：由版本唯一派生的 `vX.Y.Z`。
- `specSources`：用户指定的一项或多项可读取规格。
- `acceptedChanges`：规格中已经实现并验收的用户可感知变化。
- `reviewStatus`：`unspecified`、`reviewing`、`approved` 或 `blocked`。

**规则**：缺少目标版本或规格时保持 `unspecified`；任一指定范围未验收或与交付状态不一致时进入 `blocked`；只有全部条目有规格依据且已经验收才进入 `approved`。该状态由发布准备流程和开发者单人核对，不嵌入公开正文，也不由 commit、PR 或 issue 自动推导。

## VersionedReleaseNotes

- `version` 与 `tag`：对应 `VersionReleaseScope`。
- `sourcePath`：唯一的仓库相对路径 `docs/releases/vX.Y.Z.md`。
- `title`：`# SubTandem vX.Y.Z`。
- `mode`：`changes` 或 `no-user-change`。
- `sections`：按固定顺序出现的零个或多个允许章节及其非空用户条目。
- `rawContent`：触发提交中的原始 UTF-8 正文。
- `rawSha256`：原始字节的小写 SHA-256。
- `normalizedBody`：只用于 GitHub 远端比较的正文，统一换行并忽略末尾空白。

**规则**：`changes` 至少包含一个允许章节；`no-user-change` 只包含固定无变化句。两种模式互斥。文件名、标题、项目版本和 tag 必须一致，技术发布证据字段不得出现。

**处理状态**：

```text
missing/invalid -> rejected
valid -> validated -> audited-copy -> published
audited-copy -> draft-resumed -> published
audited-copy + matching-public -> skipped
audited-copy + remote-mismatch -> conflict
```

任何 `rejected` 或 `conflict` 状态都不得产生远端写入。

## TechnicalReleaseEvidence

- `version`、`tag` 与 `commit`：既有不可变发布身份。
- `artifact`：安装包名称、包内版本、大小和 SHA-256。
- `gates`：八项自动化门禁结果。
- `entries`：最终归档清单。
- `helpers`：构建文件和包内两个 native helper 的架构、权限、签名、最低系统、依赖与摘要。
- `ffmpeg`：对应源码资产、许可证和摘要。
- `releaseNotes`：`sourcePath` 与 `rawSha256`，只证明正文来源，不复制用户功能条目。
- `hostValidation`：正式安装、卸载和实际播放的覆盖状态，CI 均记录为 `not-covered`。

**规则**：该实体写入 `release-audit.json`、Actions 摘要与日志；校验文件继续作为既有公开资产。除 `releaseNotes` 身份外，技术字段不得进入 GitHub Release 用户正文，也不得进入 `.iinaplgz`。

## RemoteReleaseSnapshot

- `releaseId`：远端 Release 身份。
- `state`：`absent`、`draft`、`published` 或 `conflict`。
- `prerelease`：必须为 `false`。
- `tagCommit` 与 `targetCommitish`：新建或恢复 draft 时必须符合既有 004 生命周期契约。
- `body`：与 `VersionedReleaseNotes.normalizedBody` 比较。
- `assets`：既有四项公开资产的名称和内容摘要。
- `latest`：新公开版本必须为 Latest。

**状态转换**：

```text
absent -> draft -> published
matching-draft -> draft -> published
matching-published -> skipped
draft/published mismatch -> conflict
```

公开版本正文相同即可跳过，不要求其 tag 移动到同版本后续提交；正文不同进入 `conflict`，不修改 tag、正文或资产。

## 关系

- 一个 `VersionReleaseScope` 只对应一个 `VersionedReleaseNotes`。
- 一个经过审计的 `VersionedReleaseNotes.rawSha256` 必须记录在同版本的 `TechnicalReleaseEvidence` 中。
- 一个新公开 `RemoteReleaseSnapshot.body` 必须等于对应 `VersionedReleaseNotes.normalizedBody`。
- `TechnicalReleaseEvidence` 与 `RemoteReleaseSnapshot` 共享版本、tag 和首次发布的触发提交，但承担不同职责：前者证明发布可信度，后者向用户说明功能变化。
