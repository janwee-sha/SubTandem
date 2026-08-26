---
name: repo-img-compressor
description: 将 SubTandem 仓库 docs/ 下受版本控制的静态 PNG、JPEG 或 WebP 图片以 WebP quality 90 压缩，保持显示尺寸与文件名主体，在扩展名变化时同步更新 README 与 docs 文档引用并移除确认无引用的旧格式文件。用于用户要求压缩、优化、减小、转 WebP 或批量处理 SubTandem 文档图片时；不处理插件运行时资源、忽略目录中的实机测试截图、SVG 或动画图片。
---

# SubTandem 文档图片压缩

使用内置脚本和仓库开发依赖 `sharp` 把文档图片压缩为 WebP quality 90。不要调用图像生成模型，也不要修改产品代码或插件包内容。

## 边界

- 只处理仓库 `docs/` 下受 Git 跟踪的常规 `.png`、`.jpg`、`.jpeg` 与 `.webp` 文件。
- 保持显示方向下的像素尺寸与文件名主体：`foo.png` 转为同目录的 `foo.webp`。
- 保留透明通道；应用 JPEG 等格式的 EXIF 方向。
- 拒绝符号链接、目录、Git 未跟踪或忽略文件、SVG、GIF、APNG 和动画 WebP。`docs/manual-test-recording/` 中的实机验证材料不属于优化对象。
- 不调整固定的 quality 90。用户要求其他质量、缩放或其他输出格式时，说明该请求不属于本技能的固定策略。
- 使用仓库锁定的 `sharp` 开发依赖。缺少时从仓库根目录运行 `npm install` 恢复依赖；不要临时链接或从其他仓库加载依赖。

## 工作流

1. 在仓库根目录读取 `AGENTS.md`、`docs/engineering/constitution.md` 和初始 `git status --short`。把此任务作为轻量文档资源维护：保护无关改动，不自动暂存。
2. 把用户指定范围解析为明确文件列表。范围含糊时先询问；不得把单图请求扩大为全部 `docs/`。只有用户明确要求处理当前新增文档图片时，才对其使用 `--allow-untracked`。
3. 检查输入及目标 `<原文件名主体>.webp`。目标已存在且不是输入本身时停止确认，不得静默覆盖。
4. 用 `view_image` 查看输入并记录显示尺寸与字节数。多图任务逐一检查，不按扩展名假定内容有效。
5. 从仓库根目录预检映射：

   ```bash
   node <skill-dir>/scripts/compress-images.mjs --root <repo-root> --dry-run <image> [...]
   ```

   只处理用户明确指定的新增文档图片时添加 `--allow-untracked`。
6. 映射无冲突后执行压缩：

   ```bash
   node <skill-dir>/scripts/compress-images.mjs --root <repo-root> <image> [...]
   ```

   仅在用户明确批准替换既有同名 `.webp` 时添加 `--force`。脚本默认跳过体积未减小的结果；只有用户明确优先统一格式时添加 `--allow-larger`。
7. 检查脚本 JSON 输出。确保结果为 WebP、尺寸符合源图显示方向、文件可解码且非空；用 `view_image` 检查 UI 文字、细线、渐变、透明边缘和色彩。出现明显伪影时停止，不自行改变质量参数。
8. 扩展名变化时，用 `rg -n --fixed-strings` 搜索脚本返回的 `source`、相对文档路径及旧文件名。通过最小 `apply_patch` 更新根 `README.md`、多语言 `docs/readme/*.md` 或其他 `docs/` 文档中的真实引用，保留原 query/hash。
9. 再次搜索旧路径。仅在输出通过验证且旧路径不再被引用后删除被替换的旧格式文件。结果为 `skipped-not-smaller` 时保留源文件，不改引用。
10. 引用变化后运行 `npm run format:check`；随后运行 `git diff --check`，审查 `git diff` 和 `git status --short`，确认除了本技能固定的 `sharp` 开发依赖外，没有修改产品代码、发布脚本、插件包、其他依赖或任务范围外文件。

## 预览请求

用户只要求查看效果或比较版本时，添加 `--preview` 生成同目录 `<文件名主体>.preview.webp`，完成视觉与体积比较后保留原文件，不更新引用、不删除候选版本。不要把预览文件报告为正式替换结果。

## 完成报告

逐个报告源文件与输出文件的仓库相对路径、尺寸、压缩前后字节数和节省比例；说明更新的引用、删除的旧格式文件及验证命令。若目标冲突、结果更大、存在明显伪影、依赖不可用或引用无法确认，准确报告并停留在安全状态。
