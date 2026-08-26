# 契约：插件更新身份

## 清单输入

正式插件清单必须提供：

```json
{
  "version": "0.1.0",
  "ghRepo": "janwee-sha/SubTandem",
  "ghVersion": 1000
}
```

## 验证规则

1. `version` 必须是无前缀、无 prerelease、无 build metadata 的稳定 SemVer。
2. 三个版本分量必须均为 0–999。
3. `ghRepo` 必须与公开仓库精确一致。
4. `ghVersion` 必须是安全正整数，并等于版本映射结果。
5. 源码清单、发布元数据、staging 目录和最终归档必须得到同一更新身份。

任一规则失败时，构建或发布命令必须非零退出，不得生成或公开可发布状态。

## 更新判断

- 远端 `ghVersion` 大于已安装值：存在可用更新。
- 远端 `ghVersion` 等于或小于已安装值：不存在可用更新。
- 远端清单不可用或无效：检查失败，不改变当前安装。

## 下载边界

更新继续使用 `janwee-sha/SubTandem` 最新正式 GitHub Release 中的 `.iinaplgz`。不允许源码回退、其他仓库、镜像或插件自定义下载器进入本功能。

## 兼容边界

SubTandem v0.1.0 从首版提供 `ghRepo` 和 `ghVersion`，后续稳定版本沿用同一字段与映射规则。
