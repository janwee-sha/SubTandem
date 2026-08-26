# 数据模型：SubTandem 双平台打赏入口

## 打赏渠道

| 字段 | 爱发电 | Ko-fi |
| --- | --- | --- |
| 规范地址 | 临时资料中已确认的 item 链接 | `https://ko-fi.com/ianhsia` |
| 受众 | 中国大陆用户 | 海外用户 |
| 支持语义 | 请 SubTandem 作者喝杯咖啡 | Buy the SubTandem creator a Coffee |
| 权益 | 无额外权益、无模型额度 | 无额外权益、无模型额度 |

**校验规则**：所有公开入口必须使用规范地址；渠道不得暗示购买产品能力或翻译额度。

## 公开打赏入口

| 类型 | 字段 | 规则 |
| --- | --- | --- |
| README | 语言、两条链接、边界文案 | 7 份文档全部存在且已本地化 |
| 二维码 | 图片路径、目标地址 | 仅简体中文 README 展示，目标等于规范爱发电地址 |
| Sponsor | Ko-fi 用户名、爱发电地址 | 两者同时配置 |

## Ko-fi 页面设置

| 字段 | 值 |
| --- | --- |
| 展示名 | `Ian` |
| 用户名 | `ianhsia` |
| 简介 | `Support SubTandem by buying its creator a coffee.` |
| 网站 | `https://github.com/janwee-sha/SubTandem` |
| 类别 | `Software` |
| 国家 | `United States` |
| 邮编 | 用户确认的美国邮编，只提交到 Ko-fi；仓库与验证输出不得记录具体值 |
| 币种 | `USD` |
| 模式 | Coffee metaphor |
| 单位 | `Coffee` |
| 单杯金额 | `5` |
| 最低金额 | `5` |
| CTA | `Tip` |
| 默认频率 | 一次性 |
| 自动感谢 | 规格定义的英文文案 |

**状态转换**：已登录且 PayPal 已连接 → 填写待保存值 → 即时确认 → 保存 → 公开页面复核。若出现 CAPTCHA、身份复核或额外敏感字段，停止并交由用户处理。
