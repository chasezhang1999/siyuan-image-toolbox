import {
    confirm,
    Dialog,
    fetchSyncPost,
    getActiveEditor,
    getAllEditor,
    IEventBusMap,
    Menu,
    Plugin,
    showMessage,
} from "siyuan";
import {
    buildExcalidrawSvg,
    dataURLToBytes,
    decodeExcalidrawSvg,
    extractUnannotatedImage,
    ImageSource,
    restoredAssetName,
    SUPPORTED_IMAGE_MIME_TYPES,
} from "./excalidraw";
import {buildInvertCss} from "./invert";
import "./style.css";

interface PluginSettings {
    autoPaste: boolean;
    lockBackground: boolean;
    confirmBatch: boolean;
    darkInvert: boolean;
}

type MenuItem = Parameters<Menu["addItem"]>[0];
type ImageMenuDetail = IEventBusMap["open-menu-image"];

interface ExcalidrawReference {
    blockId: string;
    path: string;
}

interface RevertEntry {
    blockId: string;
    from: string;
    to: string;
}

interface RevertLog {
    time: number;
    entries: RevertEntry[];
}

/** The parts of siyuan-embed-excalidraw used to open its editor right after a conversion. */
interface EmbedExcalidrawPlugin {
    isMobile?: boolean;
    data?: Record<string, unknown>;
    getExcalidrawImageInfo?: (imageURL: string, reload?: boolean) => Promise<unknown>;
    openEditDialog?: (info: unknown) => void;
    openEditTab?: (info: unknown) => void;
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
    darkInvert: true,
};

const SETTINGS_FILE = "settings.json";
const INVERT_EXCLUSIONS_FILE = "invert-exclusions.json";
const REVERT_LOG_FILE = "revert-log.json";
const EMBED_PLUGIN_NAME = "siyuan-embed-excalidraw";
const NODE_ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;
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
    /** Session-only switch: a page reload turns inversion back on. */
    private invertPaused = false;
    /** data-src values of images the user excluded from dark-mode inversion. */
    private invertExclusions = new Set<string>();
    private invertStyle: HTMLStyleElement | null = null;
    private lastRevert: RevertLog | null = null;

    async onload() {
        const stored = await this.loadData(SETTINGS_FILE) as Partial<PluginSettings> | undefined;
        this.settings = {...DEFAULT_SETTINGS, ...(stored ?? {})};
        const exclusions = await this.loadData(INVERT_EXCLUSIONS_FILE) as {paths?: string[]} | undefined;
        this.invertExclusions = new Set(exclusions?.paths ?? []);
        const revertLog = await this.loadData(REVERT_LOG_FILE) as RevertLog | undefined;
        this.lastRevert = revertLog?.entries?.length ? revertLog : null;
        this.applyInvertStyle();
        // iconImageToolbox: a picture whose right half is dark (dark-mode inversion) with a red mark (annotation).
        this.addIcons(`<symbol id="iconImageToolbox" viewBox="0 0 32 32">
            <path d="M16 5.5h9.5a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3H16z" opacity=".35"/>
            <rect x="3.5" y="5.5" width="25" height="21" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
            <circle cx="10" cy="12" r="2.3"/>
            <path d="m5.5 23 6-6 4 4 3.5-4 6.5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <rect x="17.5" y="12.5" width="9" height="7" rx="1.5" fill="none" stroke="#e03131" stroke-width="1.8"/>
        </symbol>
        <symbol id="iconImageToExcalidraw" viewBox="0 0 32 32">
            <path d="M5 6h22v17H5z" fill="none" stroke="currentColor" stroke-width="2"/>
            <path d="m7 20 6-6 5 5 3-3 4 4" fill="none" stroke="currentColor" stroke-width="2"/>
            <path d="M20 5l7 7M24 4l4 4-8 8-4 1 1-4z" fill="var(--b3-theme-primary)" stroke="currentColor" stroke-width="1.5"/>
        </symbol>`);

        this.addTopBar({
            icon: "iconImageToolbox",
            title: "图片工具箱",
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
        this.addCommand({
            langKey: "临时关闭或恢复图片反色",
            langText: "临时关闭或恢复图片反色",
            hotkey: "",
            callback: () => this.setInvertPaused(!this.invertPaused),
        });
        this.eventBus.on("paste", this.onPaste);
        this.eventBus.on("open-menu-image", this.onOpenImageMenu);
        window.addEventListener("message", this.onExcalidrawSaveMessage);
    }

    onunload() {
        this.eventBus.off("paste", this.onPaste);
        this.eventBus.off("open-menu-image", this.onOpenImageMenu);
        window.removeEventListener("message", this.onExcalidrawSaveMessage);
        this.invertStyle?.remove();
        this.invertStyle = null;
    }

    openSetting() {
        const dialog = new Dialog({
            title: "图片工具箱设置",
            width: "560px",
            content: `<div class="image-to-excalidraw-settings">
                <p class="image-to-excalidraw-settings__intro">深色模式下自动反色图片；需要标注时，把图片转成可继续编辑的 Excalidraw 画布（配合“嵌入式系列 Excalidraw”插件打开编辑），没标注的还能还原成普通图片。</p>
                ${this.settingRow("autoPaste", "粘贴图片时自动转换", "读取剪贴板中的二进制图片；文字和网页 HTML 不受影响。")}
                ${this.settingRow("lockBackground", "默认锁定底图", "在 Excalidraw 中打开后，底图不会被误拖动；仍可手动解锁。")}
                ${this.settingRow("confirmBatch", "批量转换前确认", "显示将要转换的图片数量，并提醒处理期间不要编辑文档。")}
                ${this.settingRow("darkInvert", "深色模式下图片自动反色", "白底截图在深色模式下变成深底，和 Excalidraw 图一致；单张图片可右键设为不反色。")}
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
            this.settings.darkInvert = this.readCheckbox(container, "darkInvert");
            this.applyInvertStyle();
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
        if (!this.settings.darkInvert) {
            menu.addItem({
                icon: "iconEye",
                label: "开启图片反色（当前已永久关闭）",
                click: () => void this.setDarkInvert(true),
            });
        } else {
            menu.addItem(this.invertPaused ? {
                icon: "iconPlay",
                label: "恢复图片反色（当前临时关闭中）",
                click: () => this.setInvertPaused(false),
            } : {
                icon: "iconPause",
                label: "临时关闭图片反色（刷新后恢复）",
                click: () => this.setInvertPaused(true),
            });
            menu.addItem({
                icon: "iconEyeoff",
                label: "永久关闭图片反色",
                click: () => void this.setDarkInvert(false),
            });
        }
        menu.addSeparator();
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
        menu.addItem({
            icon: "iconImage",
            label: "还原未标注的 Excalidraw 图（当前文档）",
            click: () => void this.revertUnannotated("doc"),
        });
        menu.addItem({
            icon: "iconImage",
            label: "还原未标注的 Excalidraw 图（全部文档）",
            click: () => void this.revertUnannotated("all"),
        });
        if (this.lastRevert) {
            menu.addItem({
                icon: "iconUndo",
                label: `撤销上次还原（${this.lastRevert.entries.length} 处）`,
                click: () => void this.undoLastRevert(),
            });
        }
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

    private applyInvertStyle() {
        if (!this.invertStyle) {
            this.invertStyle = document.createElement("style");
            this.invertStyle.id = `${this.name}-invert`;
            document.head.append(this.invertStyle);
        }
        this.invertStyle.textContent = buildInvertCss(this.settings.darkInvert && !this.invertPaused, this.invertExclusions);
    }

    private setInvertPaused(paused: boolean) {
        if (!this.settings.darkInvert) {
            showMessage("图片反色已永久关闭，可在插件菜单里重新开启", 3500, "info");
            return;
        }
        this.invertPaused = paused;
        this.applyInvertStyle();
        showMessage(paused ? "已临时关闭图片反色，刷新页面后恢复" : "已恢复图片反色", 3000, "info");
    }

    private async setDarkInvert(enabled: boolean) {
        this.settings.darkInvert = enabled;
        this.invertPaused = false;
        this.applyInvertStyle();
        await this.saveData(SETTINGS_FILE, this.settings);
        showMessage(enabled ? "已开启深色模式图片反色" : "已永久关闭图片反色，可在插件菜单里重新开启", 3500, "info");
    }

    private async toggleImageInvert(dataSrc: string) {
        const excluded = this.invertExclusions.has(dataSrc);
        if (excluded) {
            this.invertExclusions.delete(dataSrc);
        } else {
            this.invertExclusions.add(dataSrc);
        }
        this.applyInvertStyle();
        await this.saveData(INVERT_EXCLUSIONS_FILE, {paths: Array.from(this.invertExclusions)});
        showMessage(excluded ? "这张图在深色模式下恢复反色" : "这张图在深色模式下不再反色", 2500, "info");
    }

    private onOpenImageMenu = (event: CustomEvent<ImageMenuDetail>) => {
        const detail = event.detail;
        const image = detail.element?.querySelector<HTMLImageElement>("img");
        const dataSrc = image?.getAttribute("data-src") ?? "";
        const path = this.normalizeAssetPath(dataSrc);
        if (!image || !LOCAL_ASSET_PATTERN.test(path)) {
            return;
        }
        const items: MenuItem[] = [];
        if (this.isConvertibleAssetPath(path)) {
            items.push({
                icon: "iconImageToExcalidraw",
                label: "转为 Excalidraw 标注",
                click: () => void this.convertSingleImage(detail, image, path),
            });
        }
        const excluded = this.invertExclusions.has(dataSrc);
        items.push({
            icon: excluded ? "iconDark" : "iconLight",
            label: excluded ? "深色模式下恢复反色" : "深色模式下不反色",
            click: () => void this.toggleImageInvert(dataSrc),
        });
        // Items added to detail.menu land in a nested "插件" submenu; the live menu keeps them one click away,
        // the same way siyuan-embed-excalidraw places its "编辑 Excalidraw" item.
        const liveMenu = (window as unknown as {siyuan?: {menus?: {menu?: Menu}}}).siyuan?.menus?.menu;
        items.forEach((item) => (liveMenu ?? detail.menu).addItem(item));
    };

    private async convertSingleImage(detail: ImageMenuDetail, image: HTMLImageElement, path: string) {
        if (this.busy) {
            showMessage("已有转换任务正在进行", 3000, "info");
            return;
        }
        const block = detail.element.closest<HTMLElement>("[data-node-id]");
        const blockId = block?.dataset.nodeId;
        if (!block || !blockId) {
            showMessage("找不到这张图片所在的块", 4000, "error");
            return;
        }
        this.busy = true;
        try {
            const source = await this.assetPathToImageSource(path);
            const newPath = await this.createAndUploadAsset(source);
            const editor = getAllEditor().find((item) => item.protyle === detail.protyle);
            const index = Array.from(block.querySelectorAll<HTMLImageElement>("img[data-src]")).indexOf(image);
            if (editor && index >= 0) {
                // Same pattern SiYuan uses for its own image menu edits: swap the block DOM, then record
                // the update with its inverse so Ctrl+Z restores the plain image.
                const oldHTML = block.outerHTML;
                const clone = block.cloneNode(true) as HTMLElement;
                const target = clone.querySelectorAll<HTMLImageElement>("img[data-src]")[index];
                target.setAttribute("data-src", newPath);
                target.setAttribute("src", newPath);
                target.removeAttribute("data-srcset");
                const newHTML = clone.outerHTML;
                block.outerHTML = newHTML;
                editor.transaction(
                    [{action: "update", id: blockId, data: newHTML}],
                    [{action: "update", id: blockId, data: oldHTML}],
                );
            } else if (!await this.replaceInBlock(blockId, new Map([[path, newPath]]))) {
                throw new Error("文档中找不到这张图片的引用");
            }
            const opened = await this.openInExcalidrawEditor(newPath);
            showMessage(opened ? "已转为 Excalidraw，可以开始标注" : "已转为 Excalidraw，点图片右上角的编辑按钮开始标注", 4000, "info");
        } catch (error) {
            console.error(`[${this.name}] Failed to convert ${path}`, error);
            showMessage(`转换失败：${this.errorMessage(error)}`, 6000, "error");
        } finally {
            this.busy = false;
        }
    }

    private async openInExcalidrawEditor(path: string) {
        const embed = this.app.plugins.find((plugin) => plugin.name === EMBED_PLUGIN_NAME) as unknown as EmbedExcalidrawPlugin | undefined;
        if (!embed?.getExcalidrawImageInfo || !embed.openEditDialog) {
            return false;
        }
        try {
            const info = await embed.getExcalidrawImageInfo(path, true);
            if (!info) {
                return false;
            }
            const config = Object.values(embed.data ?? {}).find((value): value is {editWindow?: string} =>
                typeof value === "object" && value !== null && "editWindow" in value);
            if (!embed.isMobile && config?.editWindow === "tab" && embed.openEditTab) {
                embed.openEditTab(info);
            } else {
                embed.openEditDialog(info);
            }
            return true;
        } catch (error) {
            console.warn(`[${this.name}] Could not open the Excalidraw editor`, error);
            return false;
        }
    }

    private async revertUnannotated(scope: "doc" | "all") {
        if (this.busy) {
            showMessage("已有转换任务正在进行", 3000, "info");
            return;
        }
        let rootId: string | undefined;
        if (scope === "doc") {
            const editor = getActiveEditor(false);
            rootId = editor?.protyle?.block?.rootID;
            if (!editor || !rootId) {
                showMessage("请先打开并聚焦一个文档", 4000, "error");
                return;
            }
            await (editor as typeof editor & {flushPendingTransactions?: () => Promise<void>}).flushPendingTransactions?.call(editor);
        }
        let references: ExcalidrawReference[];
        try {
            references = await this.findExcalidrawReferences(rootId);
        } catch (error) {
            showMessage(`读取图片引用失败：${this.errorMessage(error)}`, 6000, "error");
            return;
        }
        const count = new Set(references.map((reference) => reference.path)).size;
        if (count === 0) {
            showMessage(scope === "doc" ? "当前文档中没有 Excalidraw 图" : "没有找到 Excalidraw 图", 3500, "info");
            return;
        }
        const where = scope === "doc" ? "当前文档" : "全部文档";
        const wait = scope === "all" ? "图片多时需要几分钟，期间请不要编辑相关文档。" : "处理期间请不要编辑该文档。";
        confirm(
            "还原未标注的 Excalidraw 图",
            `将检查${where}中的 ${count} 张 Excalidraw 图，把只含一张原图、没做过任何改动的还原为普通图片；有标注或改动的保持不变。原 SVG 文件不会删除，之后可在插件菜单里「撤销上次还原」。${wait}`,
            () => void this.performRevert(references),
        );
    }

    private async findExcalidrawReferences(rootId?: string) {
        if (rootId && !NODE_ID_PATTERN.test(rootId)) {
            throw new Error(`无效的文档 ID：${rootId}`);
        }
        // Only blocks whose markdown holds the image inline; document blocks (covers) and HTML blocks are skipped.
        const rows = await this.sql<ExcalidrawReference>(`SELECT DISTINCT a.block_id AS blockId, a.path AS path
            FROM assets a JOIN blocks b ON b.id = a.block_id
            WHERE a.path LIKE 'assets/%excalidraw-%.svg' AND b.type IN ('p', 't', 'h')
            ${rootId ? `AND a.root_id = '${rootId}'` : ""}
            LIMIT 100000`);
        return rows.filter((row) => EXCALIDRAW_ASSET_PATTERN.test(row.path));
    }

    private async performRevert(references: ExcalidrawReference[]) {
        this.busy = true;
        const paths = Array.from(new Set(references.map((reference) => reference.path)));
        const progress = this.openProgress("正在还原图片", paths.length, (current, total) => `已检查 ${current} / ${total} 张 Excalidraw 图…`);
        const restored = new Map<string, string>();
        const failures: string[] = [];
        let annotated = 0;
        try {
            for (let index = 0; index < paths.length; index++) {
                const path = paths[index];
                try {
                    // no-cache revalidates, so a canvas annotated on another device is never judged from a stale copy.
                    const response = await fetch(`/${path}`, {cache: "no-cache"});
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    const scene = decodeExcalidrawSvg(await response.text());
                    const image = scene ? extractUnannotatedImage(scene) : null;
                    if (!image) {
                        annotated++;
                    } else {
                        const newPath = `assets/${restoredAssetName(path, image.mimeType, this.newNodeId())}`;
                        await this.putAsset(newPath, new Blob([dataURLToBytes(image.dataURL)], {type: image.mimeType}));
                        restored.set(path, newPath);
                    }
                } catch (error) {
                    failures.push(path);
                    console.error(`[${this.name}] Failed to inspect ${path}`, error);
                }
                progress.update(index + 1, paths.length);
            }

            progress.setText("正在更新文档…");
            const byBlock = new Map<string, Map<string, string>>();
            for (const reference of references) {
                const newPath = restored.get(reference.path);
                if (newPath) {
                    const replacements = byBlock.get(reference.blockId) ?? new Map<string, string>();
                    replacements.set(reference.path, newPath);
                    byBlock.set(reference.blockId, replacements);
                }
            }
            const entries: RevertEntry[] = [];
            for (const [blockId, replacements] of byBlock) {
                try {
                    if (await this.replaceInBlock(blockId, replacements)) {
                        replacements.forEach((to, from) => entries.push({blockId, from, to}));
                    } else {
                        failures.push(blockId);
                    }
                } catch (error) {
                    failures.push(blockId);
                    console.error(`[${this.name}] Failed to update block ${blockId}`, error);
                }
            }
            if (entries.length > 0) {
                this.lastRevert = {time: Date.now(), entries};
                await this.saveData(REVERT_LOG_FILE, this.lastRevert);
            }
            const suffix = failures.length ? `；${failures.length} 处失败，详见开发者控制台` : "";
            showMessage(`已还原 ${restored.size} 张（${entries.length} 处引用），${annotated} 张有标注或改动，保持不变${suffix}`, 8000, failures.length ? "error" : "info");
        } finally {
            progress.close();
            this.busy = false;
        }
    }

    private async undoLastRevert() {
        const log = this.lastRevert;
        if (!log || this.busy) {
            return;
        }
        confirm("撤销上次还原", `将把上次还原的 ${log.entries.length} 处图片引用改回 Excalidraw 图。`, async () => {
            this.busy = true;
            const byBlock = new Map<string, Map<string, string>>();
            for (const entry of log.entries) {
                const replacements = byBlock.get(entry.blockId) ?? new Map<string, string>();
                replacements.set(entry.to, entry.from);
                byBlock.set(entry.blockId, replacements);
            }
            let failed = 0;
            try {
                for (const [blockId, replacements] of byBlock) {
                    try {
                        if (!await this.replaceInBlock(blockId, replacements)) {
                            failed++;
                        }
                    } catch (error) {
                        failed++;
                        console.error(`[${this.name}] Failed to undo block ${blockId}`, error);
                    }
                }
                this.lastRevert = null;
                await this.removeData(REVERT_LOG_FILE);
                showMessage(failed ? `撤销完成，${failed} 个块未能改回（可能已被删除或修改）` : "已撤销上次还原", 5000, failed ? "error" : "info");
            } finally {
                this.busy = false;
            }
        });
    }

    /** Rewrites asset paths inside one block through its kramdown, which keeps widths, titles and attributes. */
    private async replaceInBlock(blockId: string, replacements: Map<string, string>) {
        const response = await fetchSyncPost("/api/block/getBlockKramdown", {id: blockId});
        const kramdown = response.data?.kramdown;
        if (response.code !== 0 || typeof kramdown !== "string") {
            throw new Error(response.msg || "无法读取块内容");
        }
        let next = kramdown;
        replacements.forEach((to, from) => {
            next = next.split(from).join(to);
        });
        if (next === kramdown) {
            return false;
        }
        const update = await fetchSyncPost("/api/block/updateBlock", {id: blockId, dataType: "markdown", data: next});
        if (update.code !== 0) {
            throw new Error(update.msg || "更新块失败");
        }
        return true;
    }

    private async sql<T>(stmt: string) {
        const response = await fetchSyncPost("/api/query/sql", {stmt});
        if (response.code !== 0) {
            throw new Error(response.msg || "SQL 查询失败");
        }
        return (response.data ?? []) as T[];
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
        const progress = this.openProgress("正在转换图片", candidates.length);
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
        const path = `assets/excalidraw-image-${this.newNodeId()}.svg`;
        await this.putAsset(path, new Blob([svg], {type: "image/svg+xml"}));
        return path;
    }

    private async putAsset(path: string, content: Blob) {
        const name = path.split("/").pop() ?? "asset";
        const form = new FormData();
        form.append("path", `data/${path}`);
        form.append("file", new File([content], name, {type: content.type}));
        form.append("isDir", "false");
        const response = await fetch("/api/file/putFile", {method: "POST", body: form});
        if (!response.ok) {
            throw new Error(`写入资源 ${name} 失败（HTTP ${response.status}）`);
        }
        const result = await response.json();
        if (result.code !== 0) {
            throw new Error(result.msg || `写入资源 ${name} 失败`);
        }
    }

    private newNodeId() {
        const lute = window.Lute as typeof window.Lute & {NewNodeID?: () => string};
        return lute?.NewNodeID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }

    private openProgress(
        title: string,
        total: number,
        describe = (current: number, count: number) => `已处理 ${current} / ${count} 张图片…`,
    ) {
        const dialog = new Dialog({
            title,
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
                text.textContent = describe(current, count);
            },
            setText: (value: string) => {
                text.textContent = value;
            },
            close: () => dialog.destroy(),
        };
    }

    private errorMessage(error: unknown) {
        return error instanceof Error ? error.message : String(error);
    }
}
