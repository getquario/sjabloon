export * from "./types.js";
import type { SjabloonRender, SjabloonTemplate } from "./types.js";

/**
 * Compile a template once, render it many times to a plain string.
 *
 * `{{ expr }}` interpolates unescaped — escaping belongs at the output edge —
 * so `{{{ expr }}}` has no meaning here and is a compile-time
 * `SJABLOON_RAW_TAG` error.
 */
export const template: SjabloonTemplate<string>;
export const render: SjabloonRender<string>;
