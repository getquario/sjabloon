export * from "./types.js";
import type { SjabloonRender, SjabloonTemplate } from "./types.js";

/**
 * Compile a template once, render it many times to an HTML string.
 *
 * `{{ expr }}` HTML-escapes (`& < > " '`) and `{{{ expr }}}` interpolates raw.
 * This is the only edition that knows what HTML is; the rest of sjabloon leaves
 * escaping to the output edge.
 */
export const template: SjabloonTemplate<string>;
export const render: SjabloonRender<string>;
