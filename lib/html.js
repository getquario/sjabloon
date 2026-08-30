/**
 * The HTML edition: `{{ }}` HTML-escapes, `{{{ }}}` interpolates raw. This is
 * 0.6's behaviour, kept for templates that target HTML directly. Everything
 * else in sjabloon is output-neutral; escaping lives here and nowhere else.
 */
import { display, make } from "./core.js";

/** @type {Record<string, string>} */
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export { isDiagnostic, relocate } from "./core.js";

// The string accumulator is this edition's own shape, so its profile is stated
// here rather than named in the core: every node is shorter than an import of
// it, and the core stays the parser alone. `{{ }}` escapes at the markup edge;
// `{{{ }}}` is the same display text, verbatim.
export const { template, render } = make([
  (text) => (scope, acc) => (acc.text += text),
  (expr) => (scope, acc) => (acc.text += display(expr(scope)).replace(/[&<>"']/g, (c) => ESC[c])),
  (expr) => (scope, acc) => (acc.text += display(expr(scope))),
  () => ({ text: "" }),
  (acc) => acc.text,
]);
