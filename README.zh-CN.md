# 图片转 Excalidraw

把思源笔记中的普通图片变成可由“嵌入式系列 Excalidraw”继续编辑和标注的 SVG 画布。

## 功能

- 粘贴剪贴板中的 PNG、JPEG、WebP、GIF、BMP、SVG、ICO、AVIF 或 JFIF 图片时自动转换。
- 从顶栏菜单批量转换当前文档的全部普通本地图片。
- 每个图片引用生成独立画布；同一张原图出现两次时，可分别标注。
- 原图片资源默认保留；批量替换作为一组文档事务提交，可在思源中撤销。
- 默认锁定画布中的底图，避免标注时误拖动。

## 安装与配套插件

1. 从 [GitHub 仓库](https://github.com/chasezhang1999/siyuan-image-to-excalidraw) 下载 `package.zip`。
2. 新建思源工作空间目录 `data/plugins/siyuan-image-to-excalidraw/`，将 `package.zip` **内部的文件**解压到这个目录；不要把 ZIP 文件本身或额外的同名文件夹再套一层。
3. 在思源的插件设置中启用“图片转 Excalidraw”。
4. 安装并启用 [嵌入式系列 Excalidraw](https://github.com/YuxinZhaozyx/siyuan-embed-excalidraw)，以便点击生成的画布进行编辑。

即使未安装配套插件，生成的 SVG 也能作为普通图片显示；配套插件负责打开 Excalidraw 编辑器。

## 使用

### 自动转换粘贴图片

默认开启。复制截图或图片文件后直接粘贴到文档，插件会先生成 `assets/excalidraw-image-*.svg`，再通过与 `/excalidraw` 相同的编辑器插入接口把图片块插入光标位置。通过顶栏的图片图标可以随时关闭自动转换。

保存 Excalidraw 后，插件会为当前文档中的同一资源刷新显示缓存，避免文件已经保存但编辑器仍显示旧图或空白。

网页中复制出的纯 HTML 图片没有二进制文件时不会拦截，仍按思源默认方式粘贴。

### 批量转换当前文档

打开目标文档，点击顶栏的图片图标，选择“批量转换当前文档图片”。确认后插件会处理当前文档的所有本地图片，并跳过：

- 已经是 `excalidraw-*.svg/png` 的图片；
- 网络图片和 `data:` 图片；
- 音视频、附件及不支持的格式。

处理时请暂时不要编辑该文档。转换完成后原图仍留在 `assets` 中，可后续用思源的资源清理功能自行处理。

## 数据格式

插件不会创建私有数据库。生成文件是标准 SVG，包含 `application/vnd.excalidraw+json` 元数据和原始图片数据，文件名遵循配套插件识别的 `excalidraw-*.svg` 规则。

## 许可证

MIT
