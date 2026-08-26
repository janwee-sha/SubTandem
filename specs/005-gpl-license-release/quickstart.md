# 快速验证：GPL 许可与首版合规发布

## 本地验证

1. 确认 `LICENSE`、npm 元数据与 README 徽章统一为 `GPL-3.0-only`。
2. 依次运行完整 TypeScript、Swift、构建、包校验与打包门禁。
3. 审计最终归档，确认根目录包含 `LICENSE` 与 `THIRD_PARTY_NOTICES.txt`，且二者与仓库一致。
4. 核对两个 helper 的双架构、可执行权限、签名、最低系统版本与系统动态依赖边界。

## 远端验证

1. 推送唯一初始提交并等待 Automatic Release 完成。
2. 核对 v0.1.0 tag 指向触发提交，Release 为公开稳定 Latest。
3. 下载远端资产并确认 SHA-256、正文与本地审计一致。

## 人工宿主验收

使用最终 `.iinaplgz` 在 IINA 1.4+ 完成安装、启用、播放和卸载；自动化结果不能替代实际宿主操作。
