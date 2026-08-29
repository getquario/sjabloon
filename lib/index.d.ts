export * from "./types.js";
import type { SjabloonFunctions, SjabloonRenderer, SjabloonValues, Token } from "./types.js";

/**
 * Compile a template once, render it many times to a token stream.
 *
 * `{{ expr }}` emits a value token; escaping belongs to whoever consumes the
 * stream, so `{{{ expr }}}` has no meaning here and is a compile-time
 * `SJABLOON_RAW_TAG` error.
 *
 * @see SjabloonRenderer for `names`/`functions`, SjabloonScope for `$` and `@`.
 * @throws {SyntaxError} On malformed tags, unclosed blocks, or bad expressions.
 */
export function template(
  str: string,
  funcs?: SjabloonFunctions,
  opts?: { bound?: Iterable<string> },
): SjabloonRenderer<Token[]>;

/** Compile and render in one go. Shorthand for `template(str, funcs)(values)`. */
export function render(str: string, values?: SjabloonValues, funcs?: SjabloonFunctions): Token[];

/**
 * Join a token stream into the string `sjabloon/text` would have produced:
 * literals verbatim, values through `display()`.
 */
export function text(tokens: readonly Token[]): string;

/**
 * Display text for one interpolated value — the scalar rule `text()` and the
 * string editions share. A valid `Date` renders as ISO 8601 UTC
 * (`toISOString()`), deterministically across machines; an invalid `Date`
 * stays `"Invalid Date"`; nullish displays empty; everything else is
 * `String(value)`.
 */
export function display(value: unknown): string;
