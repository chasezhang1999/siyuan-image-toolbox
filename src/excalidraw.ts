import {deflate, inflate} from "pako";

export const SUPPORTED_IMAGE_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/svg+xml",
    "image/x-icon",
    "image/avif",
    "image/jfif",
]);

export interface ImageSource {
    dataURL: string;
    mimeType: string;
    width: number;
    height: number;
    sourceName?: string;
}

export interface ExcalidrawBuildOptions {
    lockImage?: boolean;
    padding?: number;
    now?: number;
    idFactory?: () => string;
}

const randomId = () => {
    const cryptoObject = globalThis.crypto;
    if (cryptoObject?.randomUUID) {
        return cryptoObject.randomUUID().replaceAll("-", "").slice(0, 20);
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
};

const randomSeed = () => Math.floor(Math.random() * 2_000_000_000) + 1;

const bytesToBinaryString = (bytes: Uint8Array) => {
    const chunks: string[] = [];
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
    }
    return chunks.join("");
};

/** Uses the same encoded payload envelope consumed by Excalidraw's SVG importer. */
export const encodeExcalidrawPayload = (sceneJSON: string) => {
    const compressed = deflate(sceneJSON);
    const envelope = {
        version: "1",
        encoding: "bstring",
        compressed: true,
        encoded: bytesToBinaryString(compressed),
    };
    return btoa(JSON.stringify(envelope));
};

const escapeAttribute = (value: string) => value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export const buildExcalidrawSvg = (image: ImageSource, options: ExcalidrawBuildOptions = {}) => {
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(image.mimeType)) {
        throw new Error(`Unsupported image MIME type: ${image.mimeType}`);
    }
    if (!Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0) {
        throw new Error("The source image has invalid dimensions.");
    }

    const idFactory = options.idFactory ?? randomId;
    const now = options.now ?? Date.now();
    const padding = Math.max(0, options.padding ?? 10);
    const fileId = idFactory();
    const elementId = idFactory();
    const width = Math.round(image.width * 1000) / 1000;
    const height = Math.round(image.height * 1000) / 1000;
    const canvasWidth = width + padding * 2;
    const canvasHeight = height + padding * 2;

    const element = {
        id: elementId,
        type: "image",
        x: padding,
        y: padding,
        width,
        height,
        angle: 0,
        strokeColor: "transparent",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        index: "a0",
        roundness: null,
        seed: randomSeed(),
        version: 1,
        versionNonce: randomSeed(),
        isDeleted: false,
        boundElements: null,
        updated: now,
        link: null,
        locked: options.lockImage ?? true,
        status: "saved",
        fileId,
        scale: [1, 1],
        crop: null,
    };

    const scene = {
        type: "excalidraw",
        version: 2,
        source: "https://excalidraw.com",
        elements: [element],
        appState: {
            gridSize: null,
            viewBackgroundColor: "#ffffff",
        },
        files: {
            [fileId]: {
                mimeType: image.mimeType,
                id: fileId,
                dataURL: image.dataURL,
                created: now,
            },
        },
    };
    const payload = encodeExcalidrawPayload(JSON.stringify(scene));
    const href = escapeAttribute(image.dataURL);

    return [
        `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}" width="${canvasWidth}" height="${canvasHeight}">`,
        "<!-- svg-source:excalidraw -->",
        "<metadata>",
        "<!-- payload-type:application/vnd.excalidraw+json -->",
        "<!-- payload-version:2 -->",
        "<!-- payload-start -->",
        payload,
        "<!-- payload-end -->",
        "</metadata>",
        `<image href="${href}" x="${padding}" y="${padding}" width="${width}" height="${height}" preserveAspectRatio="none"/>`,
        "</svg>",
    ].join("\n");
};

export interface ExcalidrawElement {
    type?: string;
    isDeleted?: boolean;
    fileId?: string;
    angle?: number;
    crop?: unknown;
    link?: string | null;
    opacity?: number;
    scale?: [number, number];
}

export interface ExcalidrawScene {
    type?: string;
    elements?: ExcalidrawElement[];
    files?: Record<string, {mimeType?: string; dataURL?: string}>;
}

/** Reads the scene that Excalidraw (or buildExcalidrawSvg) embeds in an SVG's metadata payload. */
export const decodeExcalidrawSvg = (svg: string): ExcalidrawScene | null => {
    const match = svg.match(/<!-- payload-start -->\s*([A-Za-z0-9+/=\s]+?)\s*<!-- payload-end -->/);
    if (!match) {
        return null;
    }
    // atob yields the same byte string that was passed to btoa, so JSON.parse can read it directly.
    const outer = JSON.parse(atob(match[1].replace(/\s+/g, ""))) as ExcalidrawScene & {
        compressed?: boolean;
        encoded?: string;
    };
    if (typeof outer.encoded !== "string") {
        // Older payloads stored the scene itself without the compressed envelope.
        return outer.type === "excalidraw" ? outer : null;
    }
    const bytes = Uint8Array.from(outer.encoded, (character) => character.charCodeAt(0));
    const json = outer.compressed ? inflate(bytes, {to: "string"}) : new TextDecoder().decode(bytes);
    return JSON.parse(json) as ExcalidrawScene;
};

export interface EmbeddedImage {
    mimeType: string;
    dataURL: string;
}

/**
 * Returns the embedded image when the canvas still holds nothing but that one image:
 * no annotations, links, crops, rotation, flips or opacity changes that a plain image would lose.
 */
export const extractUnannotatedImage = (scene: ExcalidrawScene): EmbeddedImage | null => {
    const live = (scene.elements ?? []).filter((element) => !element.isDeleted);
    if (live.length !== 1 || live[0].type !== "image") {
        return null;
    }
    const image = live[0];
    const scale = image.scale ?? [1, 1];
    const untouched = !image.angle
        && image.crop == null
        && !image.link
        && (image.opacity ?? 100) === 100
        && scale[0] === 1
        && scale[1] === 1;
    if (!untouched || !image.fileId) {
        return null;
    }
    const file = scene.files?.[image.fileId];
    if (!file?.dataURL?.startsWith("data:") || !file.mimeType || !SUPPORTED_IMAGE_MIME_TYPES.has(file.mimeType)) {
        return null;
    }
    return {mimeType: file.mimeType, dataURL: file.dataURL};
};

export const dataURLToBytes = (dataURL: string) => {
    const comma = dataURL.indexOf(",");
    const header = dataURL.slice(0, comma);
    const body = dataURL.slice(comma + 1);
    if (header.endsWith(";base64")) {
        return Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
    }
    return new TextEncoder().encode(decodeURIComponent(body));
};

const MIME_EXTENSION: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/svg+xml": "svg",
    "image/x-icon": "ico",
    "image/avif": "avif",
    "image/jfif": "jpg",
};

/** assets/excalidraw-image-<id>.svg -> image-<id>.png, so a restored file stays traceable to its canvas. */
export const restoredAssetName = (svgPath: string, mimeType: string, fallbackId: string) => {
    const stem = (svgPath.split("/").pop() ?? "")
        .replace(/\.svg$/i, "")
        .replace(/^excalidraw-(?:image-)?/i, "");
    return `image-${stem || fallbackId}.${MIME_EXTENSION[mimeType] ?? "png"}`;
};
