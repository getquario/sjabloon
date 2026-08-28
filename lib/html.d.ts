export * from "./types.js";
import type { SjabloonFunctions, SjabloonRenderer, SjabloonValues } from "./types.js";

/**
 * Compile a template once, render it many times to an HTML string.
 *
 * `{{ expr }}` HTML-escapes (`& < > " '`) and `{{{ expr }}}` interpolates raw.
 * This is the only edition that knows what HTML is; the rest of sjabloon leaves
 * escaping to the output edge.
 *
 * @see SjabloonRenderer for `names`/`functions`, SjabloonScope for `$` and `@`.
 * @throws {SyntaxError} On malformed tags, unclosed blocks, or bad expressions.
 */
export function template(
  str: string,
  funcs?: SjabloonFunctions,
  opts?: { bound?: Iterable<string> },
): SjabloonRenderer<string>;

/** Compile and render in one go. Shorthand for `template(str, funcs)(values)`. */
export function render(str: string, values?: SjabloonValues, funcs?: SjabloonFunctions): string;
