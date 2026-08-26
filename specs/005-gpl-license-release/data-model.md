# 数据模型：GPL 许可与首版合规发布

## LicenseIdentity

- `spdx`：固定为 `GPL-3.0-only`。
- `licenseFile`：仓库根 `LICENSE`，内容为标准 GNU GPL v3 全文。
- `readmeBadge`：显示 GPL v3 并链接当前仓库许可文件。

## PackageComplianceFiles

- `LICENSE`：项目许可全文，归档根必需普通文件。
- `THIRD_PARTY_NOTICES.txt`：实际随包组件的名称、版本、版权和适用许可，归档根必需普通文件。
- 两个文件必须与仓库源文件逐字一致。

## ReleaseIdentity

- 由 `version`、`tag`、`commit`、`artifactName`、`byteSize`、`sha256`、发布正文摘要、门禁和归档清单共同确定。
- 成功状态要求公开、非 prerelease、Latest、tag 指向触发提交且资产与审计一致。
- 已存在且一致的稳定身份只能只读跳过；任何漂移均失败关闭。
