export * from "./types.js";
import type { SjabloonFunctions, SjabloonRenderer, SjabloonValues } from "./types.js";

/**
 * Compile a template once, render it many times to a plain string.
 *
 * `{{ expr }}` interpolates unescaped — escaping belongs at the output edge —
 * so `{{{ expr }}}` has no meaning here and is a compile-time
 * `SJABLOON_RAW_TAG` error.
 *
 * @see SjabloonRenderer for `names`/`functions`, SjabloonScope for `$` and `@`.
 * @throws {SyntaxError} On malformed tags, unclosed blocks, or bad expressions.
 */
export function template(str: string, funcs?: SjabloonFunctions): SjabloonRenderer<string>;

/** Compile and render in one go. Shorthand for `template(str, funcs)(values)`. */
export function render(str: string, values?: SjabloonValues, funcs?: SjabloonFunctions): string;
