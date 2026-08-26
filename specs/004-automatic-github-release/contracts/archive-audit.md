# 最终归档审计契约

## 输入

- 已通过现有 `scripts/pack.sh` 生成的 `.iinaplgz`。
- 发布元数据脚本确认的版本与产物名。
- 触发工作流的精确 commit SHA。
- 八项门禁全部通过的结构化状态。
- 009 版本化用户说明的权威路径与元数据阶段原始摘要。
- 两个 native helper 的构建文件、锁定 FFmpeg 源码与 `native/ffmpeg.lock.json`。

## ZIP 安全边界

1. 任何条目都不得使用绝对路径、反斜线、空段、`.`、`..`、NUL 或盘符路径。
2. 条目名不得在大小写不敏感比较后重复，不得加密或表示符号链接。
3. 根目录只允许 `Info.json`、`README.md`、`LICENSE`、`THIRD_PARTY_NOTICES.txt` 与 `dist/`；五个类别均必须存在。
4. `dist/` 内拒绝源码、测试、规格、依赖树、构建缓存、运行时目录、日志、source map、环境文件、凭据、证书私钥和密钥材料。
5. 先完成上述中央目录校验，再解包到唯一临时目录；无论成功或失败都只清理该临时目录。

## 版本与 native helper

- 文件名必须为 `SubTandem-X.Y.Z.iinaplgz`，包内 `Info.json.version` 必须等于发布元数据版本。
- 构建文件和包内 `dist/native/subtandem-transport`、`dist/native/subtandem-subtitle-extractor` 必须分别包含 `arm64` 与 `x86_64`，声明最低 macOS 12，具有可执行权限，通过 `codesign --verify --strict`，且只依赖系统动态库。
- 包内 ZIP 模式和解包后的文件模式都必须保留可执行位。
- 锁定 FFmpeg 源码的名称、版本、许可证和 SHA-256 必须与 `native/ffmpeg.lock.json` 一致。

## 输出

- 原始安装包的同名副本。
- `<安装包名>.sha256`，内容为小写 SHA-256、两个空格和安装包文件名。
- 锁定 FFmpeg 源码与同名 `.sha256`。
- `release-notes.md`，与 009 权威版本化用户说明原始摘要一致的正文副本，只作为 GitHub Release body 输入。
- `release-audit.json`，记录发布身份、归档、门禁、两个 helper、FFmpeg、正文摘要及三项宿主未覆盖状态；Actions 摘要和日志呈现同一技术证据。

只有安装包、安装包校验、FFmpeg 源码和源码校验属于公开下载资产；正文副本与审计 JSON 只在工作流产物中传递。

任一检查失败时不得生成可发布输出。
