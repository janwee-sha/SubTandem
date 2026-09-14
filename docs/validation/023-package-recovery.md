# 打包故障修复与验证

日期：2026-09-14。轨道：轻量缺陷修复。范围：023 功能交付的 native 构建与打包前置检查，不改变插件运行时、包内容契约或版本。

## 根因与修复

- 原样执行 `npm run pack` 复现 transport 缺失；源目录 `dist/native/` 为空，并非暂存区漏拷贝。native 构建会先清空该目录，`pack` 不负责重新编译。
- 当前选中的 Command Line Tools，其 Swift 兼容库只有 arm64/arm64e，缺少 x86_64。最小 macOS 12 x86_64 程序在该工具链链接失败，使用已安装的完整 Xcode 则成功。本次通过 `DEVELOPER_DIR` 为 native 构建及测试选择完整 Xcode，没有修改全局 `xcode-select`。
- 当前 Command Line Tools 的 `lipo` 同时校验两个架构时报 `-verify_arch requires exactly one input file`。构建与审计脚本改为分别检查 arm64、x86_64，两项均必须成功；真实 x86_64 单架构程序仍被 arm64 检查拒绝。
- `pack` 在清理暂存区前调用现有完整审计；构建输入无效时提示重新构建，并保留旧暂存区和已有安装包。新增三个缺件回归与一个架构调用契约，均先验证失败再修复通过。

工具链选择及完整命令顺序见[开发指南](../engineering/development.md)。

## 最终代码后的质量门

环境：macOS 26.6.2（25G83）、arm64、Node.js 24.18.0、npm 11.16.0、Xcode 26.6。最终脚本修改后从全量测试重新开始，以下命令按顺序执行且退出码均为 0：

| 命令                     | 结果                                                        |
| ------------------------ | ----------------------------------------------------------- |
| `npm test`               | 72 个测试文件、755 项通过；4 项默认关闭的 live 测试跳过     |
| `npm run typecheck`      | 通过                                                        |
| `npm run lint`           | 通过                                                        |
| `npm run build:native`   | 三个 arm64/x86_64 universal helper 构建、签名与依赖检查通过 |
| `npm run test:native`    | transport、style picker、subtitle extractor 测试通过        |
| `npm run build`          | 插件与 WebView 编译通过                                     |
| `npm run verify:package` | 默认终端工具链审计通过                                      |
| `npm run pack`           | 默认终端工具链打包及归档检查通过                            |

native 两项命令设置 `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`。锁定 FFmpeg 源码仍有 `pkg-config` 缺失和 `mov.c` 未初始化变量警告，本次未修改依赖。格式检查、shell 语法检查与 `git diff --check` 通过。

## 本次安装包

`SubTandem-0.1.3.iinaplgz`，1,533,735 字节，生成于 2026-09-14 22:22:19 +0800。归档包含 transport、subtitle extractor、style picker 三个 helper，通过原有安全与内容白名单审计。

SHA-256：`f7ad731134778a038352308b61e6bcc9656d059be4204196e489f8abcef94308`。

本记录不替代[真实 Provider 验收](023-live-providers.md)，也不推断 IINA 宿主行为通过。[T040](../../specs/023-provider-language-detection/tasks.md) 仍未完成，人工验收必须使用本次生成的包。
