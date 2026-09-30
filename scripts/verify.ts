import assert from "node:assert/strict";
import {inflate} from "pako";
import {
    buildExcalidrawSvg,
    dataURLToBytes,
    decodeExcalidrawSvg,
    encodeExcalidrawPayload,
    extractUnannotatedImage,
    restoredAssetName,
} from "../src/excalidraw.ts";
import {buildInvertCss, INVERT_FILTER} from "../src/invert.ts";

if (!globalThis.btoa) {
    globalThis.btoa = (value: string) => Buffer.from(value, "latin1").toString("base64");
}

const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const svg = buildExcalidrawSvg({
    dataURL: pixel,
    mimeType: "image/png",
    width: 640,
    height: 360,
    sourceName: "fixture.png",
}, {
    idFactory: (() => {
        const values = ["file123", "element123"];
        return () => values.shift() ?? "fallback";
    })(),
    now: 1_700_000_000_000,
    lockImage: true,
});

assert.match(svg, /svg-source:excalidraw/);
assert.match(svg, /payload-type:application\/vnd\.excalidraw\+json/);
assert.match(svg, /<image [^>]*href="data:image\/png;base64,/);
const match = svg.match(/<!-- payload-start -->\s*([A-Za-z0-9+/=]+)\s*<!-- payload-end -->/);
assert.ok(match, "embedded Excalidraw payload should exist");

const envelope = JSON.parse(Buffer.from(match[1], "base64").toString("latin1"));
assert.equal(envelope.version, "1");
assert.equal(envelope.encoding, "bstring");
assert.equal(envelope.compressed, true);
const compressed = Uint8Array.from(envelope.encoded, (character: string) => character.charCodeAt(0));
const scene = JSON.parse(inflate(compressed, {to: "string"}));
assert.equal(scene.type, "excalidraw");
assert.equal(scene.version, 2);
assert.equal(scene.elements.length, 1);
assert.equal(scene.elements[0].type, "image");
assert.equal(scene.elements[0].locked, true);
assert.equal(scene.elements[0].fileId, "file123");
assert.equal(scene.files.file123.dataURL, pixel);

// The production decoder reads back exactly what the builder wrote.
const decoded = decodeExcalidrawSvg(svg);
assert.ok(decoded);
assert.deepEqual(decoded, scene);
assert.equal(decodeExcalidrawSvg("<svg></svg>"), null);

// A canvas that is still just the image can be restored; any edit keeps it as Excalidraw.
assert.deepEqual(extractUnannotatedImage(scene), {mimeType: "image/png", dataURL: pixel});
const withElement = (extra: object) => ({...scene, elements: [...scene.elements, {id: "r1", type: "rectangle", ...extra}]});
assert.equal(extractUnannotatedImage(withElement({})), null, "an annotation keeps the canvas");
assert.ok(extractUnannotatedImage(withElement({isDeleted: true})), "deleted annotations do not count");
const editedImage = (change: object) => ({...scene, elements: [{...scene.elements[0], ...change}]});
assert.equal(extractUnannotatedImage(editedImage({angle: 0.5})), null, "rotation is an edit");
assert.equal(extractUnannotatedImage(editedImage({crop: {x: 0, y: 0, width: 1, height: 1}})), null, "crop is an edit");
assert.equal(extractUnannotatedImage(editedImage({scale: [-1, 1]})), null, "flip is an edit");
assert.equal(extractUnannotatedImage(editedImage({link: "https://example.com"})), null, "a link is an annotation");
assert.equal(extractUnannotatedImage(editedImage({opacity: 60})), null, "opacity is an edit");

// Payloads written by Excalidraw itself (after editing in siyuan-embed-excalidraw) decode the same way.
const excalidrawStyle = `<svg><metadata><!-- payload-type:application/vnd.excalidraw+json --><!-- payload-version:2 --><!-- payload-start -->${encodeExcalidrawPayload(JSON.stringify(scene))}<!-- payload-end --></metadata></svg>`;
assert.deepEqual(decodeExcalidrawSvg(excalidrawStyle), scene);
const uncompressed = btoa(JSON.stringify({version: "1", encoding: "bstring", compressed: false, encoded: JSON.stringify(scene)}));
assert.deepEqual(decodeExcalidrawSvg(`<!-- payload-start -->${uncompressed}<!-- payload-end -->`), scene);

// Restored bytes are the original file, byte for byte.
assert.deepEqual(Buffer.from(dataURLToBytes(pixel)), Buffer.from(pixel.split(",")[1], "base64"));
assert.equal(new TextDecoder().decode(dataURLToBytes("data:image/svg+xml,%3Csvg%2F%3E")), "<svg/>");

assert.equal(restoredAssetName("assets/excalidraw-image-20260909101213-0gpu0q7.svg", "image/png", "x"), "image-20260909101213-0gpu0q7.png");
assert.equal(restoredAssetName("assets/sub/excalidraw-20260909101213-abcdefg.svg", "image/jpeg", "x"), "image-20260909101213-abcdefg.jpg");
assert.equal(restoredAssetName("assets/excalidraw-.svg", "image/webp", "fallback-id"), "image-fallback-id.webp");

// Dark-mode stylesheet: on, per-image exclusions (with a quote to prove escaping), and fully off.
const on = buildInvertCss(true, []);
assert.match(on, /html\[data-theme-mode="dark"\] \.protyle-wysiwyg \[data-type="img"\] img\[src\^="assets\/"\]/);
assert.ok(on.includes(INVERT_FILTER) && !on.includes("!important"));
const excluded = buildInvertCss(true, ['assets/a"b.png', "assets/c.png"]);
assert.ok(excluded.includes('img[data-src="assets/a\\"b.png"]'));
assert.ok(excluded.includes('img[data-src="assets/c.png"] { filter: none !important; }'));
const off = buildInvertCss(false, ["assets/c.png"]);
assert.equal(off, 'html[data-theme-mode="dark"] img[src^="assets/"] { filter: none !important; }');

console.log("Verified: SVG build/decode round trip, annotation detection, restore naming and dark-mode CSS.");
