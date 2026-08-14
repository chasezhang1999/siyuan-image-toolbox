import {deflate} from "pako";

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

export const decodeExcalidrawPayloadForTest = (payload: string) => {
    const envelope = JSON.parse(atob(payload)) as {
        compressed: boolean;
        encoded: string;
    };
    const bytes = Uint8Array.from(envelope.encoded, (character) => character.charCodeAt(0));
    if (!envelope.compressed) {
        return new TextDecoder().decode(bytes);
    }
    // Kept out of production usage; exported to validate generated assets byte-for-byte.
    return new TextDecoder().decode((globalThis as typeof globalThis & {
        __inflateForVerification?: (value: Uint8Array) => Uint8Array;
    }).__inflateForVerification?.(bytes) ?? bytes);
};
