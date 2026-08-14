import {
    confirm,
    Dialog,
    fetchSyncPost,
    getActiveEditor,
    Menu,
    Plugin,
    showMessage,
} from "siyuan";
import {buildExcalidrawSvg, ImageSource, SUPPORTED_IMAGE_MIME_TYPES} from "./excalidraw";
import "./style.css";

interface PluginSettings {
    autoPaste: boolean;
    lockBackground: boolean;
    confirmBatch: boolean;
}

interface PasteEventDetail {
    protyle?: {
        getInstance?: () => {
            insert: (markdown: string, isBlock?: boolean, useProtyleRange?: boolean) => void;
        };
    };
    resolve: (value: {
        textPlain: string;
        textHTML: string;
        siyuanHTML: string;
        files: File[];
    }) => void;
    textPlain: string;
    textHTML: string;
    siyuanHTML: string;
    files?: FileList | DataTransferItemList | File[];
}

interface ExcalidrawSaveMessage {
    event?: string;
    imageURL?: string;
}

interface BatchCandidate {
    blockId: string;
    path: string;
    imageIndexInBlock: number;
}

interface BlockSnapshot {
    id: string;
    oldHTML: string;
    element: HTMLElement;
}

const DEFAULT_SETTINGS: PluginSettings = {
    autoPaste: true,
    lockBackground: true,
    confirmBatch: true,
};

const SETTINGS_FILE = "settings.json";
const EXCALIDRAW_ASSET_PATTERN = /(?:^|\/)excalidraw-[^/]*\.(?:svg|png)(?:[?#].*)?$/i;
const LOCAL_ASSET_PATTERN = /^\/?assets\//i;
const EXTENSION_MIME: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    avif: "image/avif",
    jfif: "image/jfif",
};

export default class ImageToExcalidrawPlugin extends Plugin {
    private settings: PluginSettings = {...DEFAULT_SETTINGS};
    private busy = false;

    async onload() {
        const stored = await this.loadData(SETTINGS_FILE) as Partial<PluginSettings> | undefined;
        this.settings = {...DEFAULT_SETTINGS, ...(stored ?? {})};
        this.addIcons(`<symbol id="iconImageToExcalidraw" viewBox="0 0 32 32">
            <path d="M5 6h22v17H5z" fill="none" stroke="currentColor" stroke-width="2"/>
            <path d="m7 20 6-6 5 5 3-3 4 4" fill="none" stroke="currentColor" stroke-width="2"/>
            <path d="M20 5l7 7M24 4l4 4-8 8-4 1 1-4z" fill="var(--b3-theme-primary)" stroke="currentColor" stroke-width="1.5"/>
        </symbol>`);

        this.addTopBar({
            icon: "iconImageToExcalidraw",
            title: "图片转 Excalidraw",
            position: "right",
            callback: (event) => this.openMenu(event as MouseEvent),
        });
        this.addCommand({
            langKey: "批量转换当前文档图片为 Excalidraw",
            langText: "批量转换当前文档图片为 Excalidraw",
            hotkey: "",
            callback: () => void this.batchConvertCurrentDocument(),
        });
        this.addCommand({
            langKey: "切换粘贴图片自动转 Excalidraw",
            langText: "切换粘贴图片自动转 Excalidraw",
            hotkey: "",
            callback: () => void this.toggleAutoPaste(),
        });
        this.eventBus.on("paste", this.onPaste);
        window.addEventListener("message", this.onExcalidrawSaveMessage);
    }

    onunload() {
        this.eventBus.off("paste", this.onPaste);
        window.removeEventListener("message", this.onExcalidrawSaveMessage);
    }

    openSetting() {
        const dialog = new Dialog({
            title: "图片转 Excalidraw 设置",
            width: "560px",
            content: `<div class="image-to-excalidraw-settings">
                <p class="image-to-excalidraw-settings__intro">把普通图片包装成带有完整画布数据的 Excalidraw SVG。转换后的图片可直接显示；安装并启用“嵌入式系列 Excalidraw”插件后，可点击图片继续标注。</p>
                ${this.settingRow("autoPaste", "粘贴图片时自动转换", "读取剪贴板中的二进制图片；文字和网页 HTML 不受影响。")}
                ${this.settingRow("lockBackground", "默认锁定底图", "在 Excalidraw 中打开后，底图不会被误拖动；仍可手动解锁。")}
                ${this.settingRow("confirmBatch", "批量转换前确认", "显示将要转换的图片数量，并提醒处理期间不要编辑文档。")}
                <div class="image-to-excalidraw-settings__actions">
                    <button class="b3-button b3-button--outline" data-action="batch">批量转换当前文档</button>
                    <button class="b3-button b3-button--text" data-action="save">保存</button>
                </div>
            </div>`,
        });
        const container = dialog.element.querySelector(".image-to-excalidraw-settings") as HTMLElement;
        container.querySelector<HTMLButtonElement>('[data-action="save"]')?.addEventListener("click", () => {
            this.settings.autoPaste = this.readCheckbox(container, "autoPaste");
            this.settings.lockBackground = this.readCheckbox(container, "lockBackground");
            this.settings.confirmBatch = this.readCheckbox(container, "confirmBatch");
            void this.saveData(SETTINGS_FILE, this.settings);
            dialog.destroy();
            showMessage("设置已保存", 2500, "info");
        });
        container.querySelector<HTMLButtonElement>('[data-action="batch"]')?.addEventListener("click", () => {
            dialog.destroy();
            void this.batchConvertCurrentDocument();
        });
    }

    private settingRow(key: keyof PluginSettings, title: string, description: string) {
        return `<label class="b3-label fn__flex">
            <span class="fn__flex-1">${title}<span class="b3-label__text">${description}</span></span>
            <input class="b3-switch fn__flex-center" type="checkbox" data-setting="${key}" ${this.settings[key] ? "checked" : ""}>
        </label>`;
    }

    private readCheckbox(container: HTMLElement, key: keyof PluginSettings) {
        return container.querySelector<HTMLInputElement>(`[data-setting="${key}"]`)?.checked ?? false;
    }

    private openMenu(event: MouseEvent) {
        const menu = new Menu(`${this.name}-menu`);
        if (menu.isOpen) {
            return;
        }
        menu.addItem({
            icon: this.settings.autoPaste ? "iconSelect" : "iconClose",
            label: `粘贴图片自动转换：${this.settings.autoPaste ? "已开启" : "已关闭"}`,
            click: () => void this.toggleAutoPaste(),
        });
        menu.addItem({
            icon: "iconImageToExcalidraw",
            label: "批量转换当前文档图片",
            click: () => void this.batchConvertCurrentDocument(),
        });
        menu.addSeparator();
        menu.addItem({
            icon: "iconSettings",
            label: "设置",
            click: () => this.openSetting(),
        });
        const target = event.currentTarget as HTMLElement | null;
        const rect = target?.getBoundingClientRect();
        menu.open({
            x: rect?.right ?? event.clientX,
            y: rect?.bottom ?? event.clientY,
            isLeft: true,
        });
    }

    private async toggleAutoPaste() {
        this.settings.autoPaste = !this.settings.autoPaste;
        await this.saveData(SETTINGS_FILE, this.settings);
        showMessage(`粘贴图片自动转换已${this.settings.autoPaste ? "开启" : "关闭"}`, 3000, "info");
    }

    private onPaste = (event: CustomEvent<PasteEventDetail>) => {
        const detail = event.detail;
        const files = this.extractPasteFiles(detail.files);
        const convertible = files.filter((file) => SUPPORTED_IMAGE_MIME_TYPES.has(file.type));
        // Mixed text/file clipboard payloads are left untouched to avoid duplicating HTML or text.
        if (!this.settings.autoPaste || convertible.length === 0 || convertible.length !== files.length) {
            return;
        }

        event.preventDefault();
        void this.convertPastedFiles(detail, files, convertible);
    };

    private async convertPastedFiles(detail: PasteEventDetail, allFiles: File[], convertible: File[]) {
        const convertedMarkdown: string[] = [];
        const failed = new Set<File>();
        try {
            for (const file of convertible) {
                try {
                    const image = await this.fileToImageSource(file);
                    const path = await this.createAndUploadAsset(image);
                    convertedMarkdown.push(`![](${path})`);
                } catch (error) {
                    console.error(`[${this.name}] Failed to convert pasted image`, error);
                    failed.add(file);
                }
            }
            if (failed.size > 0) {
                detail.resolve({
                    textPlain: detail.textPlain,
                    textHTML: detail.textHTML,
                    siyuanHTML: detail.siyuanHTML,
                    files: allFiles,
                });
                showMessage("部分图片转换失败，已全部按普通图片继续粘贴", 5000, "error");
                return;
            }
            const protyle = detail.protyle?.getInstance?.();
            if (!protyle) {
                detail.resolve({
                    textPlain: detail.textPlain,
                    textHTML: detail.textHTML,
                    siyuanHTML: detail.siyuanHTML,
                    files: allFiles,
                });
                showMessage("找不到当前编辑器，已按普通图片继续粘贴", 5000, "error");
                return;
            }

            // Finish the intercepted paste with an empty payload, then use the exact
            // insertion path used by siyuan-embed-excalidraw's /excalidraw command.
            detail.resolve({textPlain: "", textHTML: "", siyuanHTML: "", files: []});
            protyle.insert(convertedMarkdown.join("\n\n"));
            if (convertedMarkdown.length > 0) {
                showMessage(`已将 ${convertedMarkdown.length} 张粘贴图片转换为 Excalidraw`, 3500, "info");
            }
        } catch (error) {
            console.error(`[${this.name}] Paste conversion failed`, error);
            detail.resolve({
                textPlain: detail.textPlain,
                textHTML: detail.textHTML,
                siyuanHTML: detail.siyuanHTML,
                files: allFiles,
            });
            showMessage("图片转换失败，已按普通图片继续粘贴", 5000, "error");
        }
    }

    private extractPasteFiles(entries?: FileList | DataTransferItemList | File[]) {
        const files: File[] = [];
        if (!entries) {
            return files;
        }
        for (let index = 0; index < entries.length; index++) {
            const entry = entries[index] as File | DataTransferItem;
            if (entry instanceof File) {
                files.push(entry);
                continue;
            }
            if (entry.kind === "file") {
                const file = entry.getAsFile();
                if (file) {
                    files.push(file);
                }
            }
        }
        return files;
    }

    private onExcalidrawSaveMessage = (event: MessageEvent) => {
        let message: ExcalidrawSaveMessage | undefined;
        try {
            message = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        } catch {
            return;
        }
        if (!message || (message.event !== "save" && message.event !== "autosave") || !message.imageURL) {
            return;
        }
        this.refreshExcalidrawImages(message.imageURL);
    };

    private refreshExcalidrawImages(imageURL: string) {
        const path = this.normalizeAssetPath(imageURL);
        if (!EXCALIDRAW_ASSET_PATTERN.test(path)) {
            return;
        }
        window.setTimeout(() => {
            const refreshedURL = `/${path}?v=${Date.now()}`;
            void fetch(refreshedURL, {cache: "no-store"}).finally(() => {
                document.querySelectorAll<HTMLImageElement>("img[data-src], img[src]").forEach((image) => {
                    const canonical = image.getAttribute("data-src") || image.getAttribute("src") || "";
                    if (this.normalizeAssetPath(canonical) !== path) {
                        return;
                    }
                    image.removeAttribute("srcset");
                    image.src = refreshedURL;
                });
            });
        }, 50);
    }

    private async batchConvertCurrentDocument() {
        if (this.busy) {
            showMessage("已有转换任务正在进行", 3000, "info");
            return;
        }
        const editor = getActiveEditor(false);
        const rootId = editor?.protyle?.block?.rootID;
        if (!editor || !rootId) {
            showMessage("请先打开并聚焦一个文档", 4000, "error");
            return;
        }

        const flushPendingTransactions = (editor as typeof editor & {
            flushPendingTransactions?: () => Promise<void>;
        }).flushPendingTransactions;
        await flushPendingTransactions?.call(editor);
        const snapshot = await this.loadDocumentSnapshot(rootId);
        const candidates = this.findBatchCandidates(snapshot);
        if (candidates.length === 0) {
            showMessage("当前文档中没有可转换的普通本地图片", 3500, "info");
            return;
        }

        const run = () => void this.performBatch(editor, snapshot, candidates);
        if (this.settings.confirmBatch) {
            confirm(
                "批量转换图片",
                `将把当前文档中的 ${candidates.length} 张普通本地图片转换为 Excalidraw。原图资源不会删除，文档修改可撤销。处理期间请暂时不要编辑该文档。`,
                run,
            );
        } else {
            run();
        }
    }

    private async performBatch(editor: ReturnType<typeof getActiveEditor>, snapshot: HTMLElement, candidates: BatchCandidate[]) {
        if (!editor) {
            return;
        }
        this.busy = true;
        const progress = this.openProgress(candidates.length);
        const failures: Array<{path: string; error: unknown}> = [];
        const blocks = new Map<string, BlockSnapshot>();

        try {
            for (let index = 0; index < candidates.length; index++) {
                const candidate = candidates[index];
                try {
                    const block = snapshot.querySelector<HTMLElement>(`[data-node-id="${candidate.blockId}"]`);
                    if (!block) {
                        throw new Error("Image block disappeared from the document snapshot.");
                    }
                    if (!blocks.has(candidate.blockId)) {
                        blocks.set(candidate.blockId, {
                            id: candidate.blockId,
                            oldHTML: block.outerHTML,
                            element: block,
                        });
                    }
                    const images = Array.from(block.querySelectorAll<HTMLImageElement>("img[data-src]"));
                    const target = images[candidate.imageIndexInBlock];
                    if (!target || this.normalizeAssetPath(target.getAttribute("data-src") ?? "") !== candidate.path) {
                        throw new Error("Image reference no longer exists.");
                    }
                    const source = await this.assetPathToImageSource(candidate.path);
                    const newPath = await this.createAndUploadAsset(source);
                    target.setAttribute("data-src", newPath);
                    target.setAttribute("src", newPath);
                    target.removeAttribute("data-srcset");
                } catch (error) {
                    failures.push({path: candidate.path, error});
                    console.error(`[${this.name}] Failed to convert ${candidate.path}`, error);
                }
                progress.update(index + 1, candidates.length);
            }

            const changedBlocks = Array.from(blocks.values()).filter((block) => block.oldHTML !== block.element.outerHTML);
            if (changedBlocks.length === 0) {
                throw new Error("No document blocks could be converted.");
            }
            const doOperations = changedBlocks.map((block) => ({
                action: "update" as const,
                id: block.id,
                data: block.element.outerHTML,
            }));
            const undoOperations = changedBlocks.map((block) => ({
                action: "update" as const,
                id: block.id,
                data: block.oldHTML,
            }));
            editor.transaction(doOperations, undoOperations);
            window.setTimeout(() => editor.reload(false), 800);

            const converted = candidates.length - failures.length;
            const suffix = failures.length ? `；${failures.length} 张失败，详见开发者控制台` : "";
            showMessage(`已转换 ${converted} 张图片，原图资源仍保留${suffix}`, 6000, failures.length ? "error" : "info");
        } catch (error) {
            console.error(`[${this.name}] Batch conversion failed`, error);
            showMessage(`批量转换失败：${this.errorMessage(error)}`, 6000, "error");
        } finally {
            progress.close();
            this.busy = false;
        }
    }

    private async loadDocumentSnapshot(rootId: string) {
        const response = await fetchSyncPost("/api/filetree/getDoc", {
            id: rootId,
            mode: 0,
            size: 102400,
        });
        if (response.code !== 0 || typeof response.data?.content !== "string") {
            throw new Error(response.msg || "无法读取当前文档");
        }
        const root = document.createElement("div");
        root.innerHTML = response.data.content;
        return root;
    }

    private findBatchCandidates(snapshot: HTMLElement) {
        const candidates: BatchCandidate[] = [];
        snapshot.querySelectorAll<HTMLImageElement>("img[data-src]").forEach((image) => {
            const path = this.normalizeAssetPath(image.getAttribute("data-src") ?? "");
            const block = image.closest<HTMLElement>("[data-node-id]");
            if (!block || !this.isConvertibleAssetPath(path)) {
                return;
            }
            const imageIndexInBlock = Array.from(block.querySelectorAll<HTMLImageElement>("img[data-src]")).indexOf(image);
            candidates.push({
                blockId: block.dataset.nodeId ?? "",
                path,
                imageIndexInBlock,
            });
        });
        return candidates;
    }

    private isConvertibleAssetPath(path: string) {
        if (!LOCAL_ASSET_PATTERN.test(path) || EXCALIDRAW_ASSET_PATTERN.test(path)) {
            return false;
        }
        const extension = this.extensionOf(path);
        return Boolean(EXTENSION_MIME[extension]);
    }

    private normalizeAssetPath(value: string) {
        try {
            const url = new URL(value, window.location.origin);
            if (url.origin !== window.location.origin) {
                return value;
            }
            return decodeURI(url.pathname).replace(/^\//, "");
        } catch {
            return value.split(/[?#]/, 1)[0].replace(/^\//, "");
        }
    }

    private extensionOf(path: string) {
        return path.split(/[?#]/, 1)[0].split(".").pop()?.toLowerCase() ?? "";
    }

    private async assetPathToImageSource(path: string) {
        const response = await fetch(`/${path}`, {cache: "no-store"});
        if (!response.ok) {
            throw new Error(`读取原图失败（HTTP ${response.status}）`);
        }
        const blob = await response.blob();
        const extensionMime = EXTENSION_MIME[this.extensionOf(path)];
        const mimeType = SUPPORTED_IMAGE_MIME_TYPES.has(blob.type) ? blob.type : extensionMime;
        if (!mimeType || !SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
            throw new Error(`不支持的图片格式：${blob.type || this.extensionOf(path)}`);
        }
        const file = new File([blob], path.split("/").pop() ?? "image", {type: mimeType});
        return this.fileToImageSource(file, path);
    }

    private async fileToImageSource(file: File, sourceName = file.name): Promise<ImageSource> {
        const mimeType = SUPPORTED_IMAGE_MIME_TYPES.has(file.type) ? file.type : EXTENSION_MIME[this.extensionOf(file.name)];
        if (!mimeType || !SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
            throw new Error(`不支持的图片格式：${file.type || file.name}`);
        }
        const dataURL = await this.fileToDataURL(file);
        const dimensions = await this.readImageDimensions(dataURL);
        return {dataURL, mimeType, ...dimensions, sourceName};
    }

    private fileToDataURL(file: File) {
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
            reader.readAsDataURL(file);
        });
    }

    private readImageDimensions(dataURL: string) {
        return new Promise<{width: number; height: number}>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve({width: image.naturalWidth, height: image.naturalHeight});
            image.onerror = () => reject(new Error("无法解析图片尺寸"));
            image.src = dataURL;
        });
    }

    private async createAndUploadAsset(image: ImageSource) {
        const svg = buildExcalidrawSvg(image, {lockImage: this.settings.lockBackground});
        const name = `excalidraw-image-${this.newNodeId()}.svg`;
        const path = `assets/${name}`;
        const form = new FormData();
        form.append("path", `data/${path}`);
        form.append("file", new File([svg], name, {type: "image/svg+xml"}));
        form.append("isDir", "false");
        const response = await fetch("/api/file/putFile", {method: "POST", body: form});
        if (!response.ok) {
            throw new Error(`写入 Excalidraw 资源失败（HTTP ${response.status}）`);
        }
        const result = await response.json();
        if (result.code !== 0) {
            throw new Error(result.msg || "写入 Excalidraw 资源失败");
        }
        return path;
    }

    private newNodeId() {
        const lute = window.Lute as typeof window.Lute & {NewNodeID?: () => string};
        return lute?.NewNodeID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }

    private openProgress(total: number) {
        const dialog = new Dialog({
            title: "正在转换图片",
            width: "460px",
            disableClose: true,
            content: `<div class="image-to-excalidraw-progress">
                <div data-progress-text>准备处理 ${total} 张图片…</div>
                <progress max="${total}" value="0"></progress>
            </div>`,
        });
        const progress = dialog.element.querySelector("progress") as HTMLProgressElement;
        const text = dialog.element.querySelector("[data-progress-text]") as HTMLElement;
        return {
            update: (current: number, count: number) => {
                progress.max = count;
                progress.value = current;
                text.textContent = `已处理 ${current} / ${count} 张图片…`;
            },
            close: () => dialog.destroy(),
        };
    }

    private errorMessage(error: unknown) {
        return error instanceof Error ? error.message : String(error);
    }
}
