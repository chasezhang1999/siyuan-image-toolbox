# 图片工具箱

思源笔记的图片小工具，管两件事：

- **深色模式下图片自动反色**：白底截图在深色模式下变成深底，颜色色相基本不变；单张图片可设为不反色，全部反色可临时或永久关闭。
- **按需标注**：需要标注时把图片转成 Excalidraw 画布（配合“嵌入式系列 Excalidraw”插件编辑）；没画过标注的画布可一键还原成普通图片。

> 本插件原名「图片转 Excalidraw」。为了不丢已有设置，插件目录名仍是 `siyuan-image-to-excalidraw`。

## 为什么默认用普通图片

Excalidraw SVG 为了能继续编辑，会把原图存两份（一份显示、一份给编辑器），且都是文本编码，体积约为原图的 3 倍；思源的图片 OCR 也不处理 SVG，图里的文字搜不到。所以推荐平时用普通图片，靠本插件在深色模式下反色；需要标注时再右键转换。

## 安装与配套插件

1. 从 [GitHub 仓库](https://github.com/chasezhang1999/siyuan-image-toolbox) 下载 `package.zip`。
2. 新建思源工作空间目录 `data/plugins/siyuan-image-to-excalidraw/`，将 `package.zip` **内部的文件**解压到这个目录；不要把 ZIP 文件本身或额外的同名文件夹再套一层。
3. 在思源的插件设置中启用“图片工具箱”。
4. 需要标注功能时，安装并启用 [嵌入式系列 Excalidraw](https://github.com/YuxinZhaozyx/siyuan-embed-excalidraw)，以便点击画布进行编辑。

即使未安装配套插件，生成的 SVG 也能作为普通图片显示；配套插件负责打开 Excalidraw 编辑器。

## 深色模式反色

深色模式下，本地普通图片会套用与配套插件相同的反色滤镜（`invert(93%) hue-rotate(180deg)`）。

- **单张不反色**：在图片上右键 →“深色模式下不反色”，再次右键可恢复。设置按图片文件记录，同一张图在所有文档里一致。
- **临时关闭全部反色**：顶栏图片工具箱图标 →“临时关闭图片反色”，包括 Excalidraw 图在内全部显示原色；刷新页面后自动恢复。
- **永久关闭全部反色**：顶栏图标 →“永久关闭图片反色”，设置会保存；之后从同一菜单重新开启。

## 按需标注

### 右键转换单张图片

在普通本地图片上右键，选择“转为 Excalidraw 标注”。插件会生成 `assets/excalidraw-image-*.svg` 并替换这一处引用；装了配套插件时会直接打开标注窗口。转错了按 Ctrl+Z 撤销。

### 还原未标注的 Excalidraw 图

顶栏图标 →“还原未标注的 Excalidraw 图”，可选当前文档或全部文档。插件逐张读取画布数据：只含一张底图、没有标注、裁剪、旋转、翻转、透明度或链接改动的，才还原成 `assets/image-*.png/jpg/...`（文件内容与当初嵌入的原图逐字节一致）；有标注或改动的保持不变。原 SVG 文件不会删除。

还原后顶栏菜单会出现“撤销上次还原”，可把这些引用改回 Excalidraw 图。全部文档模式需要下载每张 SVG 做检查，图片多时要几分钟。

### 自动转换粘贴图片

粘贴剪贴板里的 PNG、JPEG、WebP、GIF、BMP、SVG、ICO、AVIF 或 JFIF 图片时自动转成 Excalidraw 画布。默认开启，推荐在顶栏菜单里关掉，改用右键按需转换。网页中复制出的纯 HTML 图片不会拦截。

保存 Excalidraw 后，插件会为当前文档中的同一资源刷新显示缓存，避免文件已经保存但编辑器仍显示旧图或空白。

### 批量转换当前文档

顶栏图标 →“批量转换当前文档图片”。确认后插件会处理当前文档的所有本地图片，并跳过已经是 `excalidraw-*.svg/png` 的图片、网络图片和 `data:` 图片，以及音视频、附件和不支持的格式。处理时请暂时不要编辑该文档；批量替换作为一组文档事务提交，可在思源中撤销。转换后原图仍留在 `assets` 中。

## 数据格式

插件不会创建私有数据库。生成文件是标准 SVG，包含 `application/vnd.excalidraw+json` 元数据和原始图片数据，文件名遵循配套插件识别的 `excalidraw-*.svg` 规则；每个图片引用生成独立画布，底图默认锁定。

插件自己的数据在 `data/storage/petal/siyuan-image-to-excalidraw/`：`settings.json`（设置）、`invert-exclusions.json`（设为不反色的图片）、`revert-log.json`（上次还原的记录，撤销后删除）。

## 开发

`npm ci` 后 `npm run build`（类型检查 + 测试 + 打包出 `package.zip`）。图标和预览图的源文件在 `design/`，改完用 Chrome 重新导出：

```bash
chrome --headless=new --default-background-color=00000000 --window-size=160,160 --screenshot=icon.png design/icon.svg
```

## 许可证

MIT
