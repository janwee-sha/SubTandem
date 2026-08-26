# 实现计划：SubTandem v0.1.0 首版发布

**功能标识**：`018-subtandem-initial-release` | **规格**：[spec.md](spec.md)

## 方案

建立包含完整产品源码的独立仓库，在同一首版中统一产品身份、运行时内部命名、构建发布契约、测试和非打赏文档。配置、helper 与临时目录均由 SubTandem 私有身份隔离。

版本历史以 v0.1.0 为起点：将全部用户能力汇总为英文首版说明，并把既有规格中的当前版本契约统一到首版身份。自动发布使用现有 GitHub Actions 架构。

## 技术边界

- **运行时**：TypeScript Main/Global/WebView 与两个 Swift helper 全部改名，消息字段与业务行为不变。
- **存储**：新插件仅使用 `io.subtandem.iina` 私有数据和 `@tmp/subtandem-extraction`，不迁移旧数据。
- **发布**：`Info.json`、npm 元数据、pack、audit、publish、workflow 和测试统一使用 v0.1.0 与 SubTandem 产物名。
- **文档**：非打赏内容迁移品牌；打赏允许项逐字节保持；插件管理器截图只替换可见品牌文本。
- **验证**：产品身份 allowlist 审计、现有自动化门禁、正式包审计、IINA 人工验收、远端 Release 核验。
