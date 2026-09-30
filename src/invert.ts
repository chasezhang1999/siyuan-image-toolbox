/** The filter siyuan-embed-excalidraw applies to its own images in dark mode, so both kinds look alike. */
export const INVERT_FILTER = "invert(93%) hue-rotate(180deg)";

const DARK = 'html[data-theme-mode="dark"]';

const cssString = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Builds the stylesheet for dark-mode image inversion.
 * Exclusions match the image's data-src, which (unlike src) never carries cache-busting query strings.
 */
export const buildInvertCss = (active: boolean, exclusions: Iterable<string>) => {
    if (!active) {
        // !important also cancels the rule siyuan-embed-excalidraw ships for excalidraw-* images.
        return `${DARK} img[src^="assets/"] { filter: none !important; }`;
    }
    const rules = [`${DARK} .protyle-wysiwyg [data-type="img"] img[src^="assets/"] { filter: ${INVERT_FILTER}; }`];
    const selectors = Array.from(exclusions, (path) => `${DARK} img[data-src=${cssString(path)}]`);
    if (selectors.length > 0) {
        rules.push(`${selectors.join(",\n")} { filter: none !important; }`);
    }
    return rules.join("\n");
};
