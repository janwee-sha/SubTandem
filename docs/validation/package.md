# 正式包验证

## 权威证据

每个自动发布版本的权威证据由以下内容共同构成：

- `docs/releases/vX.Y.Z.md`：对应稳定版本的英文用户正文来源；经原始摘要绑定后复制为工作流产物 `release-notes.md`，直接用于 GitHub Release body。
- `SubTandem-X.Y.Z.iinaplgz.sha256`：正式安装包的可下载校验文件。
- `ffmpeg-8.1.2.tar.xz` 与同名 `.sha256`：必须与 `native/ffmpeg.lock.json` 的 URL、版本、许可证和摘要一致。
- `release-audit.json`：记录触发 commit、包内版本、精确大小、SHA-256、八项门禁、完整归档清单、三个 native helper、FFmpeg、正文路径与摘要及宿主覆盖状态。
- 对应 GitHub Actions 摘要与日志：呈现固定环境、IINA 下载校验、八项门禁、最终归档审计和发布任务结果。

用户正文只描述 009 规格允许的用户变化，不承载上述技术证据。

workflow 不为逐版本证据修改、提交或推送仓库文件，避免产生递归 `main` 触发。Git 历史、Release 和 Actions 记录承担版本历史；本文只描述当前验证契约。

## 自动发布门禁

发布流程必须严格依次通过：

```text
npm run test
npm run typecheck
npm run lint
npm run build:native
npm run test:native
npm run build
npm run verify:package
npm run pack
```

随后直接审计最终 `.iinaplgz`，确认版本与产物名一致、根目录只有 `Info.json`、`README.md`、`LICENSE`、`THIRD_PARTY_NOTICES.txt` 和 `dist/` 运行材料，不包含敏感、运行时、源码或开发文件，也不存在路径穿越、重复路径或符号链接。

`dist/native/` 必须只含 `subtandem-transport`、`subtandem-subtitle-extractor` 与 `subtandem-style-picker`。构建文件与包内文件必须分别包含 `arm64` 和 `x86_64`、最低 macOS 12、可执行权限、有效签名、相同 SHA-256，且只依赖系统动态库；归档不得包含 `native/style-picker/` 源码、测试或构建材料。

FFmpeg 静态构建材料不得进入 `.iinaplgz`。审计任务只把正式包、正式包校验、锁定源码和源码校验纳入可发布白名单；`release-audit.json` 是技术证据，`release-notes.md` 是用户正文副本，二者都不作为 Release 附件上传。

## IINA 宿主边界

GitHub Actions 不打开 IINA 图形界面，因此 `release-audit.json`、Actions 摘要与日志必须明确以下状态：

- 真实安装：CI 未覆盖。
- 真实卸载：CI 未覆盖。
- 实际播放：CI 未覆盖。
- 系统颜色/字体面板、键盘和 VoiceOver：CI 未覆盖。

这些宿主行为不得标记为已验证，不进入用户正文，也不阻塞自动正式 Release。用户执行正式包人工验收时，应使用 Release 中的 `.iinaplgz`，并以版本或 SHA-256 关联结果；开发链接不能替代正式包证据。
