# GitHub Release 生命周期契约

## 触发与权限

- `push` 只监听 `main`；`workflow_dispatch` 只有 `refs/heads/main` 可进入任务。
- 构建任务只有 `contents: read`；发布任务依赖构建和归档审计成功，只有 `contents: write`。
- 相同 ref 的发布流程串行且不取消正在运行的流程。

## 已公开版本

发现同 tag 的公开稳定 Release 时，发布接口必须比较 009 正文：规范化正文一致且 tag 仍存在时成功跳过，正文偏差时冲突失败。不得编辑正文、Latest 状态、tag 或资产，也不得要求 tag 移动到相同版本后续提交。

## 新版本

1. 若不存在同 tag Release，先检查同名 tag；不存在时 draft 的 target 为触发 SHA，存在时必须精确指向触发 SHA。
2. 使用 GitHub CLI 创建普通 draft，标题为 `SubTandem X.Y.Z`，正文来自 009 版本化用户说明的审计副本。
3. 上传前只接受安装包、安装包校验、锁定 FFmpeg 源码和源码校验四个资产名。
4. 已存在同名资产时下载并比较 SHA-256；一致则复用，不一致则失败，禁止覆盖。
5. 缺失资产上传后重新读取 draft，确认正文、目标提交和四项资产全部一致。
6. 把 draft 公开为非 prerelease 并标记 Latest；发布后确认 tag 精确指向触发 SHA、正文一致且四项资产完整。

## 恢复与冲突

- 只有 `tag`、target commit、正文及已有资产都匹配的 draft 可恢复。
- draft 中存在额外资产、同名不同内容资产或不一致 target 时必须失败并保留现场。
- 创建 draft 遇到并发冲突时可重新读取状态；若读取到匹配 draft 则继续，否则失败。
- 任一失败不得删除 tag、Release 或资产，不得使用覆盖选项。
