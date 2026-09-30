# Image Toolbox for SiYuan

Two image helpers for SiYuan:

- **Dark-mode inversion**: local images get the same `invert(93%) hue-rotate(180deg)` filter [siyuan-embed-excalidraw](https://github.com/YuxinZhaozyx/siyuan-embed-excalidraw) uses for its canvases, so white screenshots turn dark while hues stay recognisable. Single images can be excluded from the right-click menu; all inversion can be paused for the session or switched off permanently from the top bar menu.
- **On-demand annotation**: right-click an image and choose "转为 Excalidraw 标注" to turn just that image into an Excalidraw canvas and open the editor (Ctrl+Z undoes it). Canvases that were never annotated can be restored to plain images, for the current document or all documents, with a one-click undo; restored files are byte-identical to the embedded originals. Pasted images can also be converted automatically, and a whole document can be converted in one batch.

Plain images are the recommended default: an Excalidraw SVG stores the image twice as text (about 3x the size) and SiYuan's OCR does not index SVG, so convert only the images you actually annotate.

This plugin used to be called "Image to Excalidraw". Its folder is still `siyuan-image-to-excalidraw` so existing settings carry over.

## Install

Download `package.zip` from the [GitHub repository](https://github.com/chasezhang1999/siyuan-image-toolbox). Create `data/plugins/siyuan-image-to-excalidraw/` in the SiYuan workspace and extract the **contents** of the archive directly into that folder, then enable the plugin. Install siyuan-embed-excalidraw to edit the canvases; generated SVG files remain visible without it.

## Development

`npm ci`, then `npm run build` (type check, tests, and `package.zip`). Icon and preview sources live in `design/`.

## License

MIT
