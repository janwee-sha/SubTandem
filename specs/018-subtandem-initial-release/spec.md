# 功能规格：SubTandem v0.1.0 首版发布

**功能标识**：`018-subtandem-initial-release`

## 目标

将 SubTandem 作为完整独立产品交付，并以 v0.1.0 首次发布。产品显示、插件身份、运行时命名、构建发布工具、测试和项目文档必须保持一致，同时维持现有字幕翻译行为与安全边界。

## 用户故事

### 用户故事 1：安装独立的 SubTandem 插件（P1）

用户可从 `janwee-sha/SubTandem` 安装 SubTandem v0.1.0，并在 IINA 中看到独立的插件身份、侧栏与发布信息。

1. **假如** 用户安装 SubTandem，**当** 首次启动插件，**那么** 配置、凭据、helper 和临时数据全部使用 SubTandem 自己的私有身份与路径。
2. **假如** 用户运行 SubTandem，**当** 插件启动 helper、保存配置或提取字幕，**那么** 所有路径、进程与消息命名均使用 SubTandem 身份。

### 用户故事 2：获得一致的产品与发布身份（P1）

开发者和用户在源码、文档、构建产物、仓库链接及 Release 中看到一致的 SubTandem 产品身份。

1. **假如** 检查受版本控制内容，**当** 排除明确冻结的打赏功能，**那么** 所有产品名称、标识、仓库链接和命名路径均属于 SubTandem。
2. **假如** 首次推送 `main`，**当** 自动发布完成，**那么** 远端只有 v0.1.0 标签和 Release，正式包名为 `SubTandem-0.1.0.iinaplgz`。

## 功能需求

- **FR-001**：产品名必须为 `SubTandem`，插件标识必须为 `io.subtandem.iina`，更新仓库必须为 `janwee-sha/SubTandem`。
- **FR-002**：项目版本必须统一为 `0.1.0`，更新序号必须为 `1000`，正式归档必须为 `SubTandem-0.1.0.iinaplgz`。
- **FR-003**：Swift 模块、helper、WebView 全局接口、环境变量、schema ID、临时路径及测试命名必须统一使用 SubTandem 命名。
- **FR-004**：Provider、Main/Global 消息结构、权限、网络目的地、字幕处理和用户交互行为不得改变。
- **FR-005**：`docs/releases/` 必须只包含 v0.1.0 英文说明并覆盖当前完整用户能力；既有 SDD 当前契约必须使用首版语义并保留任务编号和完成状态。
- **FR-006**：七份 README 的打赏段落、`.github/FUNDING.yml`、爱发电二维码和 `specs/006-sponsor-entry/` 必须保持原样，作为产品身份扫描的唯一允许项。
- **FR-007**：不得修改 IINA 宿主仓库 README 插件列表或 `plugins.json`，不得创建相关 PR。
- **FR-008**：仓库必须以完整受版本控制源码初始化，不得纳入缓存、依赖、构建产物或忽略文件。

## 成功标准

- **SC-001**：除打赏允许项外，非 SubTandem 产品身份的文本、标识、命名路径和可见图片命中数为 0。
- **SC-002**：TypeScript、Swift、构建、打包及发布审计门禁全部通过。
- **SC-003**：IINA 正式包安装、运行、数据隔离、临时数据清理和卸载验收全部通过。
- **SC-004**：SubTandem 远端只有一个初始提交及 v0.1.0 标签和 Release。
