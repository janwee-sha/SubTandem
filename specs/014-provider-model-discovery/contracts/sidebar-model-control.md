# 契约：Sidebar Model ID 控件

## 结构与无障碍

- Model ID 区域包含原生已知模型 `<select>`、固定 `Custom model ID…` 选项、条件显示的自定义文本输入和位于选择控件右侧的刷新按钮。
- 自定义输入在显示时为必填；隐藏时不得产生重复表单值。Profile 保存消息始终只提交一个非空 Model ID。
- 刷新按钮只显示刷新图标，并具有稳定的可访问名称、键盘焦点、至少 32px 高度和 `aria-busy`；窄宽度下允许布局换为单列。
- 模型区域紧邻一个 `role="status" aria-live="polite"` 反馈槽。busy、成功与安全失败只属于 `model-catalog` 区域，独立于页面其他操作反馈，不得清除或替换 Profile 选择、Test、保存及其他区域的当前消息。

## 选项与值

- 已知选项只能来自当前目录，不得加入静态或猜测模型。
- 当前 Model ID 匹配已知项时显示为已知；不匹配、目录为空或模型从新目录消失时选择 Custom 并在文本输入中保留精确当前值。
- 刷新结果不得自动选择首项、清空或改写当前值。
- 用户选择已知项时保存其精确值；选择 Custom 时立即进入自定义模式并保留或编辑当前值，即使该值仍存在于已知目录中也不得自动切回已知模式。
- Service type、Endpoint、网络路线、Profile 或凭据上下文变化时切换到独立目录，不合并旧上下文选项。

## 触发

| 触发 | 行为 |
| --- | --- |
| IINA 启动 | Global 非阻塞预取有效已保存 Profile；不得等待或暂停播放。 |
| Sidebar 首次载入或从隐藏变为当前插件 | 刷新当前有效表单或 Profile；重复 `ui:ready` 不得误判为重新打开。 |
| Service type、Profile、New Profile 或网络路线变化 | 立即失效旧 owner；新上下文有效时自动刷新。 |
| Endpoint 输入 | 保留 Model ID，取消旧防抖；格式有效且稳定 400 毫秒后刷新。 |
| 凭据保存成功 | 取得新 owner，取代保存前已取消的同上下文请求，并以权威凭据状态刷新。 |
| 手动刷新 | 立即创建新 owner，取代重叠自动刷新，不等待防抖。 |

手动刷新时，API Key 输入框存在非空未保存值则使用独立草稿凭据请求；否则沿用常规刷新。草稿 Key 变化必须清空其目录归属并使旧请求失效，自动刷新不得读取该值。

Endpoint 为空、格式无效或仍在输入时不发请求。等价自动请求可合并，但不得合并掉手动刷新。

Profile revision 创建成功后，创建结果中的安全 Profile view 必须立即进入当前窗口列表；创建前的迟到列表响应不得移除它。后续列表刷新可更新 `credentialConfigured` 与模型目录等派生状态。

## 反馈与失败

- busy 不清空已知目录或 Model ID。
- 最新成功以新目录替换当前目录，并显示安全成功反馈；成功空目录仅留下 Custom。
- 最新失败保留上次成功目录、Model ID 与 Custom，显示基于安全分类的可操作反馈。
- 迟到、重复、已取消、已删除 Profile 或不再匹配当前上下文的结果完全忽略，不能结束较新 busy、清除较新反馈或改变选项。
- 刷新不得保存、Test、Select、创建翻译授权、改变翻译开关或发送字幕。
- Model ID 为空时点击 Save 不得发送 Profile 保存消息；模型区域必须提示用户刷新并选择已知模型或输入 Custom Model ID。

## Provider 名称与凭据

- 可见 Service type、系统默认 Profile 名、Profile 行和当前反馈统一使用 `OpenAI` 与 `Ollama`。
- OpenAI 继续允许兼容其 API 契约的自定义 HTTP(S) Endpoint。
- 两种 Service type 均显示同一可选只写 API Key 控件与 `credentialConfigured` 状态；载入已保存 Profile 时只显示占位状态，不回填 Key。
- 两种 Service type 的 API Key 字段必须沿用其他配置项的纵向结构：`API key` 主标签独占一行，输入框独占一行，只写且无需认证时可选的说明作为独立提示行显示，不得与主标签内联。
- API Key 输入框必须通过 `aria-describedby` 关联独立提示；换行不得依赖窄宽度下的偶然文字折行。
