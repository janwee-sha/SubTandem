# 数据模型：自动 GitHub Release

本功能不新增持久化产品数据。以下实体只存在于发布脚本、GitHub Actions 运行或 GitHub Release 服务中。

## ReleaseIdentity

- `version`：稳定 SemVer `X.Y.Z`。
- `tag`：`vX.Y.Z`。
- `commit`：触发工作流的 40 位 commit SHA。
- `artifactName`：`SubTandem-X.Y.Z.iinaplgz`。
- `checksumName`：`SubTandem-X.Y.Z.iinaplgz.sha256`。
- `releaseNotesPath` 与 `releaseNotesSha256`：009 版本化用户说明的权威路径与原始摘要。

五个项目版本位置必须先收敛为同一个 `version`。新版本一旦公开，tag、Release 和资产均不可修改；后续相同版本只进入 `published -> skipped`。

## ArchiveAudit

- `identity`：对应的 `ReleaseIdentity`。
- `packageVersion`：从归档内 `Info.json` 读取。
- `byteSize` 与 `sha256`：最终归档的精确大小和哈希。
- `entries`：ZIP 中央目录中的完整条目集合。
- `buildHelper` 与 `packageHelper`：各自的架构、权限和签名摘要。
- `ffmpeg`：锁定源码资产、校验资产、许可证和摘要。
- `gates`：八项门禁的通过状态。
- `releaseNotes`：正文源路径和原始摘要，不包含用户变化条目。
- `hostValidation`：安装、卸载和播放均为 `not-covered`。

只有所有字段验证通过才生成校验文件、审计 JSON、Actions 摘要和经审计的用户正文副本。技术字段不进入 GitHub Release 正文。

## ReleaseDraft

- `releaseId`：GitHub draft Release 身份。
- `tag` 与 `targetCommit`：必须与 `ReleaseIdentity` 一致。
- `body`：必须与 009 版本化用户说明的审计副本一致。
- `assets`：按名称保存远端资产 ID、大小和下载内容哈希。
- `state`：`absent`、`draft`、`published` 或 `conflict`。

**状态转换**：

```text
absent -> draft -> published
draft -> draft
published -> skipped
absent/draft -> conflict
```

- `absent -> draft`：创建非公开 Release；若 tag 已存在，必须先验证其提交。
- `draft -> draft`：同版本和提交恢复；相同资产复用，缺失资产上传。
- `draft -> published`：正文和四项资产全部一致后公开并标记 Latest。
- `published -> skipped`：完整门禁已在构建任务中完成且正文一致，发布任务不写任何对象。
- `conflict`：tag、target commit、正文、资产名或资产内容冲突；无写入和覆盖恢复路径。
