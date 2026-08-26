# 任务：SubTandem 双平台打赏入口

**输入**：`specs/006-sponsor-entry/` 中的规格与设计文档

**测试要求**：公共入口和 Release 生成行为必须先有契约测试；外部平台保存后执行人工核对。

## 阶段 1：准备

- [X] T001 将 `docs/sponsor/aifadian.jpeg` 迁移为 `docs/readme/assets/aifadian-sponsor.jpeg`，确认 `docs/sponsor/aifadian.md` 中的规范爱发电地址

## 阶段 2：基础契约

- [X] T002 添加覆盖 FUNDING、七份 README、二维码引用与私密资料边界的失败契约测试到 `tests/contract/sponsor-entry.test.ts`
- [X] T003 扩充 Release 自愿支持段落的失败断言到 `tests/contract/release-audit.test.ts`

## 阶段 3：用户故事 1——公开文档支持入口（P1）

**目标**：所有 README 提供双平台入口和完整边界，简体中文页展示爱发电二维码。

**独立测试**：运行 Sponsor 契约测试并预览各 README，扫码核对爱发电目标。

- [X] T004 [US1] 在 `README.md` 添加英文双平台自愿支持区和边界声明
- [X] T005 [US1] 在 `docs/readme/README.zh-CN.md` 添加中文双平台支持区、边界声明和二维码
- [X] T006 [US1] 在 `docs/readme/README.ko.md`、`README.ja.md`、`README.ru.md`、`README.ar.md`、`README.fr.md` 添加本地化双平台支持区和边界声明

## 阶段 4：用户故事 2——GitHub 与 Release 入口（P2）

**目标**：Sponsor 按钮和自动 Release 说明提供一致的双平台入口。

**独立测试**：Sponsor 与 Release 契约测试全部通过，现有发布证据断言保持通过。

- [X] T007 [P] [US2] 新增双平台 GitHub Sponsor 配置到 `.github/FUNDING.yml`
- [X] T008 [US2] 在 `scripts/audit-release.mjs` 的既有发布证据末尾追加双平台自愿支持段落

## 阶段 5：用户故事 3——Ko-fi Coffee 页面（P3）

**目标**：Ko-fi 公开页以 5 美元 Coffee 支持 SubTandem 创作者。

**独立测试**：保存后以公开页面和设置页核对规格要求的全部字段，不执行付款。

- [X] T009 [US3] 在 Ko-fi `https://ko-fi.com/settings?tab=profile` 填写简介与项目网站并保存
- [X] T010 [US3] 在 Ko-fi Payment 设置中使用用户确认的美国地区资料，并保存 USD、Coffee/US$5/Tip/一次性默认与自动感谢文案
- [X] T011 [US3] 通过 Ko-fi 公开页面和设置页核对最终状态，确认未启用 Stripe、会员、商店或佣金产品

## 阶段 6：收尾与验证

- [X] T012 删除临时 `docs/sponsor/`，确认认证说明、邮编和收款账户资料未进入版本控制
- [X] T013 运行 `npx vitest run tests/contract/sponsor-entry.test.ts tests/contract/release-audit.test.ts`
- [X] T014 运行 `npm run test`、`npm run typecheck`、`npm run lint` 与 `npm run format:check`
- [X] T015 按 `specs/006-sponsor-entry/quickstart.md` 完成可执行人工验收并记录尚需公开仓库确认的边界

## 依赖与执行顺序

- T001 先固定规范链接和资产路径。
- T002–T003 在实现前建立失败契约；两项完成后可进入用户故事实现。
- US1 与 US2 修改不同主要文件，可在测试契约建立后并行；T008 依赖 T003。
- US3 独立于仓库文件，但 T009–T011 必须串行，且每次外部保存前遵守即时确认。
- T012 在所有仓库引用迁移完成后执行；T013–T015 在全部实现完成后执行。

## 实现策略

1. 先完成资产迁移与契约测试。
2. 完成 README 作为最小可用入口。
3. 增加 GitHub Sponsor 与 Release 一致性。
4. 保存并核对 Ko-fi 页面。
5. 清理临时资料并运行全部验证。

## 并行边界

- 只有 T007 标记为 `[P]`，因为它与 README 和 Release 生成文件不重叠且无未完成同级依赖。
- 多语言 README 共用同一入口契约并可能由统一测试同时覆盖，按项目并行所有权原则由单一负责人顺序修改。
