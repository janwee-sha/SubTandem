# 验证指南：SubLingo 双平台打赏入口

## 自动检查

```bash
npx vitest run tests/contract/sponsor-entry.test.ts
npm run test
npm run typecheck
npm run lint
npm run format:check
```

预期：全部命令通过；契约测试验证 Sponsor、七份 README 与二维码引用。

## README 与 Sponsor 人工验收

1. 在 Markdown 预览中依次打开主 README 和六份翻译 README。
2. 确认每份均能进入爱发电和 Ko-fi，且边界声明完整。
3. 用手机扫描简体中文 README 的爱发电二维码，确认目标与文字链接相同。
4. 在公开仓库页面确认 Sponsor 按钮列出两个渠道。

## Ko-fi 人工验收

1. 打开 `https://ko-fi.com/ianhsia` 的公开页面。
2. 核对简介、项目网站、Coffee 单位、5 美元单杯与最低金额。
3. 确认页面默认一次性支持，未出现新会员、商店或佣金产品。
4. 不执行真实付款；若需验证感谢文案，只在 Ko-fi 设置页核对已保存值。

## 爱发电认证

仓库公开更新后，在爱发电认证页提交 `https://github.com/janwee-sha/SubLingo` 作为公开宣传与创作者身份的证明页面。审批结果不影响代码功能验收。
