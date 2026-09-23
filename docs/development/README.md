# SubTandem 开发指南

本文档供开发者构建、测试、打包和验收插件。

## 开发环境

- macOS 12 或更高版本
- IINA 1.4.0 或更高版本
- Node.js 24、npm 11
- Swift 6.2 或更高版本工具链，支持 `swiftbuild` backend，并包含 macOS 12 所需的 arm64 与 x86_64 兼容库
- `curl`、`shasum`、`lipo`、`codesign` 与 Xcode Command Line Tools

## 构建与自动化检查

```sh
npm ci
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
npm run test
npm run typecheck
npm run lint
npm run format:check
npm run build:native
npm run test:native
npm run build
npm run verify:package
npm run pack
```

主要命令的职责如下：

- `npm ci`：安装锁定依赖。
- `npm run test`：运行 TypeScript 自动化测试。
- `npm run typecheck`：检查插件运行时和 Sidebar 的 TypeScript 类型。
- `npm run lint`：运行 ESLint。
- `npm run build:native`：校验 `native/ffmpeg.lock.json`，由锁定源码构建 macOS 12 arm64/x86_64 静态 FFmpeg，
  并生成 transport、subtitle extractor 与 style picker 三个 universal Swift 可执行文件。
- `npm run test:native`：运行 transport、subtitle extractor 与 style picker 的 Swift 合同、安全、选择器纯逻辑和真实小样本测试。
- `npm run build`：构建插件运行时代码和 Sidebar。
- `npm run verify:package`：检查待打包内容。
- `npm run pack`：生成 `build/package/SubTandem-X.Y.Z.iinaplgz`。

原生构建会在校验源码、工具链、目标版本和架构后复用 `native/.build/ffmpeg` 与 Swift 增量目录；最终 universal helper、签名、
架构和包内容仍在每次完整检查中重新生成或验证。需要排除缓存影响时执行：

```sh
SUBTANDEM_FORCE_REBUILD=1 npm run build:native
```

如果预检提示 Swift 工具链缺少 arm64 或 x86_64 compatibility library，先确认 `DEVELOPER_DIR` 指向完整 Xcode，
不要继续使用仅包含当前主机架构库的 Command Line Tools。

## IINA 开发链接

使用 IINA 自带的插件 CLI 创建开发链接：

```sh
/Applications/IINA.app/Contents/MacOS/iina-plugin link .
```

`link` 创建 `.iinaplugin-dev` 开发链接。

移除链接时运行：

```sh
/Applications/IINA.app/Contents/MacOS/iina-plugin unlink .
```

## 正式包验收

验收正式安装包前，先移除当前 workspace 的开发链接，再打开打包产物：

```sh
/Applications/IINA.app/Contents/MacOS/iina-plugin unlink .
open build/package/SubTandem-X.Y.Z.iinaplgz
```

重启 IINA，在“设置 → 插件”中启用 SubTandem，并从播放器侧边栏打开插件。
正式 `.iinaplgz` 安装项必须可以从插件管理面板卸载；不要同时保留同一版本的正式安装项和开发链接。