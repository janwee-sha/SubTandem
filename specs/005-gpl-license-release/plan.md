# 实施计划：GPL 许可与首版合规发布

**功能目录**：`005-gpl-license-release` | **规格**：[spec.md](spec.md)

## 摘要

在仓库、元数据、README 和正式安装包中统一采用 `GPL-3.0-only`，随安装包保留实际分发组件的许可声明，并复用现有打包、最终归档审计和不可覆盖发布流程完成 v0.1.0 首次发布。

## 技术方案

- `LICENSE`、`package.json`、`package-lock.json` 与 README 徽章形成仓库许可身份。
- `pack.sh`、`verify-package.sh` 与 `audit-release.mjs` 逐层要求并核对两份合规文件。
- 发布器只创建不存在的稳定版本；相同版本后续运行必须核验并只读跳过。
- TypeScript、Swift、权限、字幕处理和运行时网络边界不变。

## 验证

运行合同测试、完整发布门禁、最终归档审计，并在发布后核对 tag、正文、资产、Latest 状态与 SHA-256。
