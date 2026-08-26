# 研究与技术决策：自动 GitHub Release

## Runner 与工具链

**决策**：构建任务使用 `runs-on: macos-15`，开始时以 `uname -m` 断言 `arm64`；固定 Node.js 24.18.0，并断言 npm 主版本为 11。

**理由**：GitHub runner-images 与托管 runner 文档把 `macos-15` 标为标准 Arm64 标签；运行期断言可防止标签映射变化被静默接受。固定 Node 小版本和 npm 主版本满足仓库 engines 与可重建要求。

**考虑过的替代方案**：`macos-latest` 会随镜像迁移；`macos-15-xlarge` 需要 larger runner 配额；Intel runner 不能直接代表目标 Arm64 构建环境。

**来源**：<https://github.com/actions/runner-images>、<https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job>

## IINA v1.4.4

**决策**：下载 `IINA.v1.4.4.dmg`，以 SHA-256 `dd0fc0bd4b37fb57a1c8d30d6e3201b3a64bafd29959fe56953964613237beb1` 验证后只读挂载，把其中的 `iina-plugin` CLI 传给现有 `scripts/pack.sh`。

**理由**：官方 v1.4.4 Release 明确发布该文件名和哈希；固定宿主工具避免 runner 预装状态影响归档格式。

**考虑过的替代方案**：使用 runner 上偶然存在的 IINA 不可重建；不校验下载会扩大供应链风险；复制打包逻辑违反现有发布技能约束。

**来源**：<https://github.com/iina/iina/releases/expanded_assets/v1.4.4>

## 官方 Action 固定版本

**决策**：固定以下官方 tag 对应的完整 commit SHA：

- `actions/checkout@v6.0.2`：`de0fac2e4500dabe0009e67214ff5f5447ce83dd`
- `actions/setup-node@v7.0.0`：`820762786026740c76f36085b0efc47a31fe5020`
- `actions/upload-artifact@v7.0.1`：`043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`
- `actions/download-artifact@v8.0.1`：`3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c`

**理由**：完整 SHA 防止可变 tag 改变执行内容；这些版本使用当前 GitHub-hosted runner 支持的 Node 24 Action runtime。

**考虑过的替代方案**：主版本 tag 和分支引用不可精确审计；第三方 Release Action 不满足最小供应链范围。

## 最终归档审计

**决策**：使用 Node.js 标准库解析 ZIP 中央目录，先验证路径、重复项、符号链接、加密标记和根目录白名单，再调用系统 `unzip` 解包。构建 helper 与包内 helper 分别调用 `lipo`、可执行权限检查和 `codesign`。

**理由**：在解包前读取中央目录可阻止路径穿越和符号链接落盘；直接审计 `.iinaplgz` 而非 staging 目录满足正式产物权威性。

**考虑过的替代方案**：只解析 `unzip -Z1` 无法可靠识别符号链接和重复项；只运行现有 staging 校验不能证明最终归档属性；新增 ZIP npm 依赖扩大供应链面。

## Draft 恢复与不可覆盖资产

**决策**：发布接口在读取远端状态前复验 009 版本化用户说明的审计摘要。公开同版本仅在规范化正文一致且 tag 仍存在时跳过；无 Release 时创建 draft；匹配版本、提交和正文的 draft 可继续。已有四项资产先下载并比较 SHA-256，完全一致才复用，缺失才上传，冲突立即失败。正文和资产全部核对后才把 draft 公开并标记 Latest。

**理由**：draft 隔离上传中断，内容比较使重试不依赖覆盖；公开 Release 不进入更新路径，保持不可变。

**考虑过的替代方案**：直接创建公开 Release 会暴露部分资产；`--clobber` 会破坏不可覆盖契约；失败时删除 draft 会丢失可恢复进度并引入破坏性操作。

## 用户正文、权限与技术证据

**决策**：公开用户正文采用 009 定义的 `docs/releases/vX.Y.Z.md` 审计副本，不从审计事实生成。安装包、门禁、归档、helper、FFmpeg 与宿主未覆盖状态写入 `release-audit.json`、校验文件、Actions 摘要与日志。workflow 顶层和构建任务使用 `contents: read`，只有依赖构建成功的发布任务使用 `contents: write`，且不回写仓库。

**理由**：用户变化与发布可信度承担不同职责；审计摘要将正文绑定到触发提交，同时让技术证据保持可追溯。GitHub Actions 可按 job 收窄 `GITHUB_TOKEN` 权限，不回写可避免递归 `main` 推送。

**考虑过的替代方案**：workflow 全局写权限扩大不必要权限；PAT 增加长期凭据；提交验证文档会触发下一轮发布流程。

**来源**：<https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax>、<https://cli.github.com/manual/gh_release_create>
