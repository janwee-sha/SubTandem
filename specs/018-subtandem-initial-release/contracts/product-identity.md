# SubTandem 产品身份契约

## 公共身份

| 字段 | 值 |
| --- | --- |
| 产品名 | `SubTandem` |
| npm 包名 | `subtandem` |
| IINA 标识 | `io.subtandem.iina` |
| GitHub 仓库 | `janwee-sha/SubTandem` |
| 版本 | `0.1.0` |
| 更新序号 | `1000` |
| 正式归档 | `SubTandem-0.1.0.iinaplgz` |

## 运行时身份

- Native helper 必须为 `subtandem-transport` 与 `subtandem-subtitle-extractor`。
- Swift target、测试 target 与 WebView 全局接口必须使用 `SubTandem` 前缀。
- 环境变量必须使用 `SUBTANDEM_` 前缀，临时提取根目录必须为 `@tmp/subtandem-extraction`。
- 插件私有数据只属于 `io.subtandem.iina`，凭据、helper 和临时文件必须保持插件私有隔离。

## 产品身份扫描允许项

以下内容保持原样，不受全局产品身份扫描约束：

- 七份 README 从 `## ☕` 标题开始的打赏段落；
- `.github/FUNDING.yml`；
- `docs/readme/assets/aifadian-sponsor.webp`；
- `specs/006-sponsor-entry/` 全部内容。
