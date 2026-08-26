# 实现计划：SubLingo 双平台打赏入口

**功能标识**：`006-sponsor-entry` | **日期**：2026-08-14 | **规格**：[spec.md](spec.md)

**输入**：`specs/006-sponsor-entry/spec.md`

## 摘要

将爱发电与 Ko-fi 作为统一的自愿支持渠道：在 GitHub Sponsor 元数据和七份多语言 README 中提供一致入口；迁移并版本化爱发电二维码；通过契约测试固定公共文案与链接；在用户已登录的 Ko-fi 页面保存公开资料、美国地区合规信息和 5 美元 Coffee 模式设置。

## 技术上下文

**语言与版本**：Markdown、YAML、Node.js 24.18.0 / JavaScript ESM

**主要依赖**：GitHub FUNDING 元数据、Vitest 3.2.7、Ko-fi 网页设置

**存储**：版本控制中的文档与静态图片；Ko-fi 托管的账户设置

**测试**：Vitest 契约测试、Prettier、二维码人工扫码、公开 Ko-fi 页面人工核对

**目标平台**：GitHub 仓库、Ko-fi、爱发电

**项目类型**：IINA 桌面插件仓库及外部创作者平台配置

**性能目标**：不影响插件运行时；README 静态资产保持单张且仅在简体中文页面加载

**约束**：不泄漏账户私密资料；不执行真实付款；不连接 Stripe 或新增付费产品；生产代码不增加注释

**范围**：7 份 README、1 份 Sponsor 配置、1 个版本化二维码、1 组契约测试、1 个 Ko-fi 页面

## 宪法检查

*门禁：Phase 0 前检查，并在 Phase 1 后复查。*

- **验证与产品安全**：通过契约测试覆盖可自动化的一致性，并保留二维码与平台页面人工验收；通过。
- **生产代码无注释且默认仅使用英语**：本功能不修改插件生产代码；通过。
- **敏感数据与外部副作用最小化**：地区与邮编只提交至 Ko-fi，不进入仓库；保存设置前执行即时确认；通过。
- **可重建且最小的发布产物**：二维码仅为仓库文档资产，打包脚本不把它加入 `.iinaplgz`；正式包审计仍验证原有最小归档；通过。
- **生产代码只实现当前功能需求**：仅加入当前要求的渠道、文案和校验，不抽象未来渠道系统；通过。

Phase 1 复查结果：设计未引入权限、运行时数据流或安装包内容变化，全部门禁继续通过。

## 项目结构

### 本功能文档

```text
specs/006-sponsor-entry/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── sponsor-entry.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### 仓库改动

```text
.github/FUNDING.yml
README.md
docs/readme/
├── README.*.md
└── assets/aifadian-sponsor.jpeg
tests/contract/sponsor-entry.test.ts
```

**结构决策**：打赏入口属于仓库公共文档与 Sponsor 元数据，不进入插件运行时源码。爱发电二维码放入既有文档资产目录，避免把临时账户资料目录长期保留。

## 复杂度跟踪

无宪法违例需要说明。
