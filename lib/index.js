/**
 * The token edition, and the engine proper: a template renders to a stream of
 * literal and value tokens. Escaping belongs to whoever consumes the stream,
 * so nothing here is HTML-aware and `{{{ }}}` has no meaning — `{{ }}` is
 * already raw.
 */
import { make } from "./core.js";

export { isDiagnostic } from "./core.js";

export const { template, render } = make([
  // Static text is a compile-time constant: hoist and freeze one token per
  // text node rather than allocating a fresh object every loop iteration.
  (text) =>
    ((token) => (scope, acc) => {
      acc.push(token);
    })(Object.freeze({ literal: text })),
  (expr) => (scope, acc) => {
    acc.push({ value: expr(scope) });
  },
  0,
  () => /** @type {import('./types.js').Token[]} */ ([]),
  (acc) => acc,
]);

/**
 * Join a token stream into the string `sjabloon/text` would have produced:
 * literals verbatim, values as `String(value ?? '')`.
 *
 * @param {readonly import('./types.js').Token[]} tokens A render's output.
 * @returns {string} The joined text.
 */
export const text = (tokens) => {
  let s = "";
  // One `?? ''` per token, so a literal never stringifies and a nullish value
  // still renders empty. Widened here because each token carries one key or
  // the other, which the public union deliberately does not model.
  for (const t of /** @type {readonly { literal?: string, value?: unknown }[]} */ (tokens))
    s += t.literal ?? String(t.value ?? "");
  return s;
};
