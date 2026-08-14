import assert from "node:assert/strict";
import {inflate} from "pako";
import {buildExcalidrawSvg} from "../src/excalidraw.ts";

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

console.log("Verified: generated SVG renders the source image and contains a valid compressed Excalidraw scene.");
