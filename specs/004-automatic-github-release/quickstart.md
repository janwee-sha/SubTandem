# 验证指南：自动 GitHub Release

## 前置条件

- macOS Arm64、Node.js 24.18.0、npm 11、Swift 6.0。
- 已按 `package-lock.json` 安装依赖。
- 本地安装 IINA 1.4.4，或设置 `IINA_PLUGIN_BIN` 指向校验后的 `iina-plugin` CLI。
- GitHub 场景验收需要 Actions 已启用且发布任务可申请 `contents: write`。

## 聚焦自动化

```sh
npm run test:release
```

预期结果：

- 版本化用户说明缺失、非法结构、摘要漂移、非法稳定 SemVer、项目版本不一致、产物名和包内版本不一致均失败。
- 根目录越界、禁用文件、路径穿越、反斜线、重复条目、符号链接和 native 属性缺失均失败。
- 新版本进入 draft 发布路径，正文一致的公开版本进入只读跳过路径，匹配 draft 可恢复，commit、正文或资产冲突失败。
- workflow 固定触发器、权限、runner、Node/IINA 版本、官方 Action SHA、八项门禁顺序和独立发布任务。

## 完整发布门禁

严格依次运行：

```sh
npm run test
npm run typecheck
npm run lint
npm run build:native
npm run test:native
npm run build
npm run verify:package
npm run pack
```

随后执行发布元数据和最终归档审计脚本，确认 `build/release/` 中的安装包与校验、锁定 FFmpeg 源码与校验、用户正文副本和审计 JSON 与 [archive-audit.md](./contracts/archive-audit.md) 一致。

## GitHub 场景验收

1. 在测试版本不存在 tag/Release 时推送 `main`，确认唯一稳定 Release、tag 精确 SHA、Latest、四项资产和 009 英文用户正文；技术证据位于审计 JSON、Actions 摘要与日志。
2. 在同版本再次触发，确认八项门禁均执行且发布任务报告跳过，远端对象没有修改。
3. 制造任一门禁、IINA SHA 或归档失败，确认没有新增公开 Release。
4. 在 draft 上传一项正确资产后重跑，确认已有资产不覆盖、缺失资产补齐后才公开。
5. 制造 commit、正文或资产内容冲突，确认流程失败且保留 draft 或公开对象供人工审计，远端写入次数为零。

## 宿主行为边界

CI 不打开 IINA 图形界面，因此不能证明正式安装、卸载或实际播放行为。`release-audit.json` 与 Actions 证据必须把三项记为 `not-covered`；它们不进入用户正文，也不阻塞自动正式发布。
