# 快速验证：自定义译文浮层垂直位置

## 前置条件

- macOS 12+、Node.js 24.18.0、npm 11，依赖已按 lock 安装。
- IINA 1.4.0 与 1.4.4、`iina-plugin` CLI；宿主自动化未经批准不得使用。
- 使用包含短行、自动换行、多行和接近可见高度译文的本地测试媒体；证据不得记录字幕或译文正文。

## 聚焦自动化

```sh
npx vitest run \
  tests/contract/overlay-position-messages.test.ts \
  tests/contract/overlay-position-preferences.test.ts \
  tests/contract/overlay-webview.test.ts \
  tests/contract/package-manifest.test.ts \
  tests/contract/sidebar-form.test.ts \
  tests/contract/sidebar-lifecycle.test.ts \
  tests/unit/overlay-position.test.ts \
  tests/unit/overlay-region-runtime.test.ts \
  tests/unit/overlay-position-sync.test.ts \
  tests/unit/overlay-state.test.ts \
  tests/unit/sidebar-state.test.ts \
  tests/integration/overlay-webview-lifecycle.test.ts \
  tests/integration/overlay-lifecycle.test.ts \
  tests/integration/performance.test.ts \
  tests/security/overlay-position-privacy.test.ts
```

预期：

- 0 至 100 全部整数、端点、无效 preference、DOM 块高、顶部钳制、底部锚定和区域变化均由生产逻辑覆盖；0 不应用纵向 margin，100 只应用 IINA 当前 `sub-margin-y + sub-margin-y-offset`，位置单调不向上。
- 几何、margin 与黑边配置逐项读取并缓存；任一可选属性失败不清除其他有效输入。`osd-dimensions` 与 `sub-use-margins` 每 100 毫秒检测一次且相同区域不重绘；普通 resize 与全屏事件不读取 mpv，shutdown 或关闭时先停止检测并解除监听。
- input 只预览；change 与窗口级指针、鼠标、触控结束信号共享一次性完成入口，触控板纯拖动缺少 change 时仍保存一次，同一拖动的重复结束信号不重复保存；set/sync 失败恢复旧值并只返回安全错误。
- A/B 跨窗口 preview/save 的成功、失败和迟到排列均 latest-only；最后发起且成功的值最终提交。
- 无当前译文不生成内容；clear 后的旧 render/layout、resize、全屏、换片和迟到消息不得恢复正文。
- Overlay 在 360p、720p、1080p 下的 CSS 字号分别为 14.5、29、43.5 像素，字重均为 400，黑色描边分别为 1、2、3 像素；字体样式先于 DOM 块高测量应用。
- Overlay CSP 禁止网络，正文不进入 preferences、Global 位置消息、日志、文件或 storage；播放器字幕轨和临时译文文件操作为 0。
- manifest 只新增 `video-overlay` 权限，Overlay HTML/资源进入正式包精确清单，旧 ASS 渲染代码和双路径测试不存在。

## 完整门禁与候选包

严格依次运行：

```sh
npm test
npm run typecheck
npm run lint
npm run build:native
npm run test:native
npm run build
npm run verify:package
npm run pack
```

预期：全部命令通过；正式包包含 Main、Global、Sidebar、Overlay 和两个既有 universal helper，不含源码、测试、SDD、凭据、运行目录或未跟踪资源。本流程不 commit、tag、上传或发布。

## 权限与文档复核

人工核对 `Info.json`、根 README、全部当前 `docs/readme/README.*.md` 和 `docs/engineering/development.md`：

- `video-overlay` 的用户披露只说明本地、非交互式译文显示；
- 不声称支持播放器画面拖动；
- 不新增网络目的地、storage、字幕轨或译文文件；
- `network-request`、`file-system` 与 `show-alert` 的既有披露仍准确。

不得用只断言文档文案的自动化测试代替该复核。

## IINA 正式包验收

在 IINA 1.4.0 与 1.4.4 使用同一候选 `.iinaplgz`。由一名开发者记录包 SHA-256、macOS、架构、IINA 版本、耗时和通过/失败，不记录字幕或译文正文。

1. 安装候选包，确认权限界面新增且只新增 `video-overlay`；打开媒体和 Sidebar，Overlay 加载失败不得阻塞播放或原字幕。
   初始冒烟时核对 IINA 日志依次出现 `Translation overlay WebView warmup started.`、`warmup completed.` 和 `ready.`，不得包含字幕或译文正文。
2. 进行 10 次首次尝试，每次在 30 秒内找到 `Subtitle` 区域的 `Position` 位置条，分别移动到顶部、中部、底部并准确报告数值。
3. 使用当前真实译文分别执行鼠标按下后拖动和触控板纯拖动，连续调整至少 100 次并覆盖 0 至 100；以 60fps 或更高录屏按帧核对 95% 在 100 毫秒内、全部在 200 毫秒内可见，反向、范围外、松手回跳、最终值未持久化和单次拖动重复保存均为 0。纯拖动结束后不再单击位置条，重开 Sidebar 核对最终值已恢复。
4. 对 0、25、50、75、100 各重复 10 次，核对 range、数值与可见位置一致；短行、自动换行、多行均底部锚定，顶部按实际块高钳制。把 IINA 原生字幕与 SubTandem 同时设为 0、100，确认 0 不含额外 OSD 顶边距，100 只保留当前原生字幕底边距，两端均不再出现译文额外向内收缩。
5. 保存非默认值后，重开 Sidebar、换片、关闭并重建窗口、重启 IINA 各 10 次；无配置与故障注入无效配置均回退 0。
6. 在窗口、全屏、有无上下黑边、IINA 黑边字幕配置两态和至少 20 次尺寸变化中核对有效区域；有黑边时连续切换配置 10 次，原生字幕与 SubTandem 均须在开关后随即采用同一边界，位置值不变；无黑边时不得跳变。
   在位置 0、100 和配置两态下分别退出全屏、关闭窗口、重载插件与退出 IINA 各 10 次，确认无退出受阻、IINA 崩溃或崩溃报告。
7. 打开两个播放窗口和两个设置页交错拖动、保存及故障注入，核对全部当前浮层、后续译文和控件收敛到最后成功 intent；迟到响应不回跳。
8. 在无当前译文、译文更新、seek、换片、禁用、关闭和保存失败场景各重复，确认无虚构/过期文本、播放与原字幕不阻塞、失败明确回退。
9. 点击译文和其周围画面、单击暂停、双击全屏、拖动窗口并使用播放器快捷键，确认 Overlay 不获得焦点或截获输入，画面不能直接拖动译文。
10. 在相同窗口高度、字体和译文内容下并排对照迁移前 `osd-overlay` 参考：720p 时确认 WebView 的 29 像素常规字重与 ASS 40/720 的可见字形宽高偏差均不超过 5%，笔画没有明显加粗；再以 360p、1080p 核对可见字形高度分别为 720p 的 0.5、1.5 倍且误差不超过 1 像素。同步核对白色、2/720 黑色描边、横向居中、换行和显示时序；使用 sentinel 检查 Log Viewer、`iina.log`、`mpv.log`、preferences、WebView storage、诊断与包，正文和敏感材料命中为 0。

只有实际完成后，才可在 `docs/validation/iina-matrix.md` 写入 016 的正式包证据；自动化、开发链接和旧包结果不得替代。
