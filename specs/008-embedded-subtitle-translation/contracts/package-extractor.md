# 字幕提取器发布契约

## 包内产物

正式 `.iinaplgz` 的 `dist/native/` 只允许：

```text
dist/native/subtandem-transport
dist/native/subtandem-subtitle-extractor
```

两者均必须：

- 包含 `arm64` 与 `x86_64`；
- 最低部署目标为 macOS 12；
- 保留可执行位并通过严格签名验证；
- 不依赖 Homebrew、`/usr/local`、workspace 或其他非系统动态库；
- 与构建后审计的 SHA-256 一致。

包内不得包含 FFmpeg 源码、头文件、静态库、对象文件、调试符号、测试、缓存或临时字幕。

## FFmpeg lock

`native/ffmpeg.lock.json` 是唯一依赖事实源，必须固定：

- 版本 `8.1.2`；
- 官方 source tarball URL 与精确 SHA-256；
- 完整 configure 参数、启用的 demuxer/decoder 与关闭的 network/GPL/nonfree 项；
- 适用许可证与对应源码资产名。

构建必须先验证摘要，禁止使用 `latest`、PATH 中的 FFmpeg 或未锁定的预编译二进制。

## 对应源码与声明

- `THIRD_PARTY_NOTICES.txt` 必须与 lock 的版本、许可证和配置一致。
- 每个正式 Release 必须同时发布精确对应的 FFmpeg source tarball 与校验文件；发布流程先审计再上传。
- `.iinaplgz` 继续包含仓库 `LICENSE` 与 `THIRD_PARTY_NOTICES.txt`，对应源码不进入运行包。
- `Info.json` 不新增权限或域名；更新描述和 `file-system` 披露，说明只读取当前本地媒体中所选文本字幕、临时用途和清理时机。

## 构建与审计

现有顶层门禁名称保持不变，但 `build:native`、`test:native`、`verify:package`、`pack` 与最终审计必须覆盖 extractor，并正向验证包内 `LICENSE`、`THIRD_PARTY_NOTICES.txt` 及其与 FFmpeg lock、对应源码资产的映射。`dist/native` 在构建前精确清理并在打包时使用白名单，避免陈旧文件进入归档。

Release 证据分别记录两个 native 组件的架构、最低系统、执行位、签名、动态依赖和 hash；不得记录媒体路径、字幕正文、译文、凭据或临时目录内容。
