import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {defineConfig} from "vite";
import {viteStaticCopy} from "vite-plugin-static-copy";
import zipPack from "vite-plugin-zip-pack";

const projectDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    plugins: [
        viteStaticCopy({
            targets: [
                {src: "plugin.json", dest: "."},
                {src: "README*.md", dest: "."},
                {src: "LICENSE", dest: "."},
                {src: "icon.png", dest: "."},
                {src: "preview.png", dest: "."},
            ],
        }),
        zipPack({
            inDir: "dist",
            outDir: ".",
            outFileName: "package.zip",
        }),
    ],
    build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: true,
        lib: {
            entry: resolve(projectDirectory, "src/index.ts"),
            formats: ["cjs"],
            fileName: () => "index.js",
        },
        rollupOptions: {
            external: ["siyuan"],
            output: {
                entryFileNames: "index.js",
                assetFileNames: (assetInfo) => assetInfo.name?.endsWith(".css") ? "index.css" : "[name][extname]",
            },
        },
    },
});
