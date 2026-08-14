# Image to Excalidraw for SiYuan

Converts pasted images and ordinary local images in the current SiYuan document into SVG canvases editable by [siyuan-embed-excalidraw](https://github.com/YuxinZhaozyx/siyuan-embed-excalidraw).

## Features

- Automatically converts binary images from the clipboard.
- Batch-converts ordinary local images in the current document.
- Creates an independent canvas for every image reference.
- Keeps the original assets and submits batch replacements with undo operations.
- Locks the background image by default.

Download `package.zip` from the [GitHub repository](https://github.com/chasezhang1999/siyuan-image-to-excalidraw). Create `data/plugins/siyuan-image-to-excalidraw/` in the SiYuan workspace and extract the **contents** of the archive directly into that folder. Enable this plugin, and install siyuan-embed-excalidraw to edit the generated canvases. Generated SVG files remain visible without the editor plugin.

## License

MIT
