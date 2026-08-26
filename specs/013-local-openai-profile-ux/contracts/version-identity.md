# 契约：0.1.0 版本身份

## 唯一身份

```json
{
  "version": "0.1.0",
  "ghRepo": "janwee-sha/SubTandem",
  "ghVersion": 1000
}
```

更新序号继续使用 `major × 1,000,000 + minor × 1,000 + patch`。正式归档名称必须为 `SubTandem-0.1.0.iinaplgz`。

## 一致性范围

以下当前交付接口必须一致：

- `Info.json` 的 `version`、`ghRepo` 与 `ghVersion`；
- `package.json` 与 `package-lock.json` 顶层及 `packages[""]` 的根项目版本；
- `scripts/pack.sh` 的 artifact 路径和受保护安全 case；
- `docs/releases/v0.1.0.md` 及读取当前版本正文的发布元数据接口；
- `docs/engineering/development.md` 的版本占位归档名，不固定为某个当前或旧版本；
- staging 与最终 `.iinaplgz` 内的 `Info.json`；
- 直接执行上述生产接口的当前版本测试。

任一字段缺失、非稳定 SemVer、仓库不匹配、序号不匹配、归档名漂移或当前发布正文缺失必须使对应元数据、构建、打包或审计接口非零退出。

## 用户发布正文

`docs/releases/v0.1.0.md` 使用英文，只描述当前首版的用户可见新功能、功能改进、问题修复或必要兼容提醒。门禁、文件清单、哈希、包大小和其他技术证据不得进入用户正文。

## 最终归档

八项门禁全部通过后，必须对最终 `build/package/SubTandem-0.1.0.iinaplgz` 调用现有 `audit-release.mjs`，验证：

- 归档名与包内版本/更新身份；
- 根文件白名单与禁止路径；
- 两个 native helper 的 arm64/x86_64、执行权限、签名、最低 macOS 与系统动态依赖；
- LICENSE、THIRD_PARTY_NOTICES 与锁定 FFmpeg 源；
- 敏感材料不存在；
- 归档 SHA-256 与发布正文身份。

仅验证 staging 或归档存在不满足本契约。

## 首版边界

0.1.0 是 SubTandem 首个稳定版本，并从首版支持 IINA 更新发现。README、本地化说明、`docs/releases/v0.1.0.md` 与 012 规格必须保持该身份一致；通用非当前版本测试 fixture 可继续用于验证版本算法。

## 发布边界

本功能只准备并验证 0.1.0 候选包和英文用户发布正文；公开发布由 018 首版发布规格在全部门禁与宿主验收通过后执行。
