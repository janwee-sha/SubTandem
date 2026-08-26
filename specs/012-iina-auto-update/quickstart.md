# 快速验证：IINA 自动更新发现

## 前置条件

- Node.js 24.18.0、npm 11。
- IINA 1.4.4 的 `iina-plugin` 可执行文件。
- 目标版本为 0.1.0。

## 聚焦自动化

```bash
npx vitest run \
  tests/contract/plugin-update-metadata.test.ts \
  tests/contract/package-manifest.test.ts \
  tests/contract/release-metadata.test.ts \
  tests/contract/release-audit.test.ts \
  tests/contract/release-workflow.test.ts
```

预期：合法 0.1.0 身份通过；缺失、仓库不匹配、非整数、版本不一致及归档漂移全部失败。

## 发布门禁

严格依次运行：

```bash
npm run test
npm run typecheck
npm run lint
npm run build:native
npm run test:native
npm run build
npm run verify:package
npm run pack
```

预期：八项全部通过，生成 `build/package/SubTandem-0.1.0.iinaplgz`。

## 最终归档

读取归档内 `Info.json`，确认：

- `version` 为 `0.1.0`；
- `ghRepo` 为 `janwee-sha/SubTandem`；
- `ghVersion` 为 `1000`；
- 归档白名单、native helper、权限、签名和敏感材料检查继续通过。

## IINA 人工验收

1. 确认当前没有同名开发链接。
2. 安装最终 `.iinaplgz`，在 IINA 1.4.4 中启用并重启。
3. 打开插件管理面板，确认 SubTandem 显示为正式安装项且可卸载。
4. 点击 `Check for Updates`，当前没有更高版本时不得错误提示升级或破坏安装。
5. 完成一次字幕翻译冒烟测试，确认运行时行为未变化。
6. 卸载并确认安装项移除。

IINA GUI 中的安装、更新检查、播放和卸载必须由用户实际执行后才能标记通过；自动化结果不能替代。
