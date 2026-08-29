---
name: iina-plugin-release
description: 统一 SubTandem IINA 插件的版本变更、基于用户指定版本规格且只描述用户功能变化的英文 release notes、质量检查、native helper 构建验收、`.iinaplgz` 正式打包、归档审计和产物摘要。用于请求提升插件版本、根据规格撰写 `docs/releases/vX.Y.Z.md`、准备发布候选包、生成正式安装包、撰写 GitHub Release 更新说明、重跑发布流水线或核验发布产物时。
---

# IINA 插件发布

## 发布原则

在仓库根目录执行完整流程。先读取 `AGENTS.md` 和项目宪法，保护工作区中的既有改动。目标版本或该版本对应规格不明确时先向用户确认；任何检查失败时停止发布，不跳过、不弱化检查，也不把失败步骤记录为通过。

继续调用项目现有的 `scripts/build-native.sh`、`scripts/verify-package.sh` 和 `scripts/pack.sh`。不要在本技能或临时脚本中复制、改写它们的 shell 实现。发布流程若暴露出需要改变产品行为、打包契约或架构的工作，停止轻量发布流程，按项目协议重新选择交付轨道。

## 1. 确认版本与规格输入

开始版本修改前，要求用户明确提供目标版本及其对应的一项或多项规格。规格输入优先使用仓库中的 `spec.md` 路径，也可使用用户提供的其他可读取原文；不得自行用 commit、PR、issue 或相邻版本的内容替代用户指定规格。缺少规格、规格无法读取、规格与目标版本的对应关系不明确时停止并向用户索取，不继续生成 release notes 或执行发布。

确认目标版本符合稳定版本 `X.Y.Z`，并列出本次采用的全部规格来源。多个规格共同组成该版本范围时全部读取；只加载理解用户故事、功能需求、验收状态和面向用户边界所需的关联产物。

## 2. 核对并变更版本

读取并比较以下项目自身版本：

- `Info.json` 的 `version`、`ghRepo` 和 `ghVersion`。
- `package.json` 的顶层 `version`。
- `package-lock.json` 的顶层 `version` 和 `packages[""]` 的 `version`。
- `scripts/pack.sh` 中决定 SubTandem 产物文件名及其安全校验路径的项目版本。

`ghRepo` 必须保持为 `janwee-sha/SubTandem`。`ghVersion` 必须按目标稳定版本的 `major * 1,000,000 + minor * 1,000 + patch` 计算，每个版本分量限于 `0..999`，并随版本提升严格递增。

只精确修改这些项目自有字段或字面量。不要全局替换旧版本号，不要修改 `package-lock.json` 中任何第三方包的 `version`、`resolved`、依赖范围或完整性数据，也不要借版本发布顺带升级依赖。打包脚本结构变化时，先识别真正控制 SubTandem 归档名称及安全边界的位置，不要根据相同数字盲改。

修改后解析三个 JSON 文件，确认项目版本全部等于目标版本；运行 `node scripts/plugin-update-metadata.mjs --manifest Info.json` 校验更新身份，并检查打包产物名也使用同一版本。用 `git diff --` 审查版本变更，确认锁文件没有无关改动后再继续。

## 3. 根据规格撰写 release notes

以用户指定规格中的当前用户故事、功能需求、验收标准和兼容边界作为版本范围的权威来源，从中提取已经实现并验收的用户可感知功能变化。使用当前代码、测试、已完成任务及必要的 PR、issue 或 commit 记录核对这些变化确实进入本次版本；这些追溯信息只能用于验证与补充链接，不得扩大或替代规格定义的范围。

若规格包含未验收的用户故事，或规格与当前实现、测试结果存在实质不一致，停止并请用户修正版本范围或先完成验收。不得把尚未交付的规格内容写成已发布功能，也不得静默删减用户指定的版本范围。

创建或更新 `docs/releases/vX.Y.Z.md`，其中 `X.Y.Z` 必须与目标版本完全一致。文件的标题与正文必须使用英文并面向最终用户，标题使用 `# SubTandem vX.Y.Z`；只保留有内容的 `New Features`、`Improvements`、`Bug Fixes` 和 `Upgrade and Compatibility Notes` 章节。某项功能在本版本首次提供时，其用户场景、可感知能力、启用条件和限制等全部细节必须在 `New Features` 中完整描述，不得把其中任何细节拆分、重复或转移到 `Improvements`；`Improvements` 仅描述本版本对既有功能的增强。每条只说明用户场景、可感知功能变化及必要的启用条件或限制，不描述技术变更、内部模块、实现过程或验证方式。没有用户可感知变化时，在标题下明确说明 `This release contains no user-facing behavior changes.`。

不要把规格原文、commit 标题或 PR 描述直接拼接为 release notes；不要记录架构、重构、内部安全机制、测试、文档、构建、门禁、依赖维护或其他技术变更。技术工作即使产生用户影响，也只能描述最终形成的用户功能变化、使用条件或兼容提醒。不要写入触发 commit、精确大小、SHA-256、归档清单、native helper 验收明细或自动化门禁结果。

用 `git diff -- docs/releases/vX.Y.Z.md` 审查措辞和路径，确认内容可由所列规格与交付状态逐条支撑。该文件是版本化的用户发布说明，必须在触发自动发布的 commit 前纳入本次版本变更。

## 4. 运行自动化发布门禁

使用项目支持的 Node.js 与 npm 版本，严格按顺序运行：

```text
npm run test
npm run typecheck
npm run lint
npm run build:native
npm run test:native
npm run build
npm run verify:package
npm run pack
```

保留每项命令的通过或失败状态。不要用后续成功掩盖前序失败；不要为了让发布通过而临时绕过测试、签名、架构或归档检查。

## 5. 验收 native helper

以 `dist/native/subtandem-transport` 和正式归档内的同一文件为两个独立验收对象。项目脚本通过后仍要记录实际结果，并确认：

- 同时包含 `arm64` 和 `x86_64`。
- 构建文件和归档解包后的文件都保留可执行权限。
- `codesign --verify --strict` 对两者均成功，签名信息可读取。

将归档解包到 `mktemp -d` 创建的临时目录进行验收，不要从开发目录状态推断包内文件状态。使用完毕后只清理已确认的临时目录。任何一项不满足都视为发布失败。

## 6. 审计正式归档

在 `npm run pack` 后直接检查生成的 `.iinaplgz`，不要只检查 staging 目录。归档根目录只允许 `Info.json`、`README.md`、`LICENSE`、
`THIRD_PARTY_NOTICES.txt` 和 `dist/` 运行及合规分发材料；两份许可文件必须与仓库根文件一致，逐项检查 `dist/`，拒绝与运行无关的内容。

确认归档不包含以下类别：

- 凭据、密钥、证书私钥、`.env` 或其他敏感材料。
- `@data`、`@tmp`、缓存、日志或其他运行时数据。
- `src`、原生工程源码、source map、测试、规格、文档源或覆盖率结果。
- `node_modules`、`.git`、`build`、`.parcel-cache`、编译中间目录或其他开发目录。
- 绝对路径、路径穿越条目或非预期符号链接。

把 `scripts/verify-package.sh` 和 `scripts/pack.sh` 作为底层校验实现，同时以最终归档清单作为发布内容的权威证据。

## 7. 输出产物证据

从最终归档本身读取 `Info.json.version`，并核对它与目标版本和文件名一致。向用户输出：

- 产物绝对路径。
- 精确字节大小；可附便于阅读的大小。
- SHA-256。
- 包内实际版本，不以文件名代替。
- 包内实际 `ghRepo` 和 `ghVersion`，不以工作区文件代替。
- native helper 的架构、可执行权限和签名验证结果。
- 八项自动化门禁的结果，以及尚未完成的人工验收。

任一版本不一致时不要把归档报告为可发布。

## 8. 使用 release notes 并保存发布证据

GitHub Release 中描述功能变化的内容必须以 `docs/releases/vX.Y.Z.md` 为来源并保持语义一致，不得在发布阶段重新根据 commit、PR 或 issue 生成另一套功能范围。PR、issue 或 commit 链接只可作为补充追溯信息。

用户发布说明不是发布验证证据页。将触发 commit、精确大小、SHA-256、归档清单、native helper 验收明细和八项门禁结果保留在同名 `.sha256` 文件、`release-audit.json`、Actions 摘要与日志中，并使它们可追溯到同一 tag 和触发 commit。

`docs/releases/vX.Y.Z.md` 必须在自动 workflow 触发前由发布准备工作生成；workflow 只读取已提交的 release notes，不得生成、修改、commit 或 push 仓库文件，也不得产生递归 `main` 触发。workflow 不得为保存证据修改 `docs/validation/package.md`；该文件只描述稳定的验证契约和证据位置，不保存逐版本流水账。本地人工重跑时，直接读取对应的版本化 release notes，并在未版本化的 `build/` 或用户指定位置生成发布证据。

## 9. 区分开发链接与正式安装

优先把以下人工测试步骤交给用户执行。只有人工测试遇到不可克服的阻力时，才使用 Computer Use 自动化界面操作。

### 开发链接

在项目根目录运行 `iina-plugin link .` 会创建 `.iinaplugin-dev` 开发链接。IINA 对该链接禁用“卸载”按钮是预期行为，不是打包缺陷；开发链接只能用于迭代，不能作为正式发布验收证据。

### 正式安装

使用最终 `.iinaplgz` 进行安装和发布验收，确保当前测试对象不是 `.iinaplugin-dev` 链接。指导用户在目标 IINA 版本中完成安装、打开插件管理面板、确认安装项存在且“卸载”按钮可用，再实际卸载并确认安装项移除。

只有用户确认正式包能够正常卸载，才能把该项记录为宿主验收通过。若尚未执行，明确说明“IINA 图形界面中的正式安装、卸载和实际播放未由 CI 覆盖”，不要宣称这些宿主行为已经验证。该状态不阻塞自动正式 Release。

## 完成条件

仅在用户已明确提供目标版本对应规格、`docs/releases/vX.Y.Z.md` 与规格和交付状态一致、版本和更新身份一致、八项自动化门禁全部通过、构建与包内 native helper 均通过验收、最终归档内容合规且产物证据已生成时完成打包工作。自动发布还必须确认公开 Release 的功能变化说明与该文件语义一致、Release 为非 prerelease、tag 指向新版本的触发 commit、资产完整且标记 Latest。IINA 图形界面中的正式安装、卸载和实际播放属于独立宿主验收；未执行时保持未覆盖状态，但不阻塞正式 Release。
