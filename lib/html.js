/**
 * The HTML edition: `{{ }}` HTML-escapes, `{{{ }}}` interpolates raw. This is
 * 0.6's behaviour, kept for templates that target HTML directly. Everything
 * else in sjabloon is output-neutral; escaping lives here and nowhere else.
 */
import { display, make } from "./core.js";

/** @type {Record<string, string>} */
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const RE = /[&<>"']/g;

/**
 * HTML-escape one display string.
 *
 * The regex drives the whole scan and the pieces are sliced out around each
 * match: a `replace` with a callback pays a JS call per escapable character,
 * and a hand-rolled `charCodeAt` walk pays one per character of the string.
 * Values that need no escaping — most of them — leave on the first `exec`.
 *
 * The walk always drains the regex to `null`, which leaves `lastIndex` at 0
 * for the next value. Resetting it on entry covers the one way out that does
 * not: a throw part way through — a value long enough to overflow the string
 * limit — would otherwise leave this shared regex primed, and the next value
 * would start scanning past its own early matches.
 *
 * @param {string} s One value's display text.
 * @returns {string} The same text with `& < > " '` replaced by entities.
 */
const esc = (s) => {
  RE.lastIndex = 0;
  let m = RE.exec(s);
  if (!m) return s;
  let out = "",
    last = 0;
  do {
    out += s.slice(last, m.index) + ESC[m[0]];
    last = m.index + 1;
  } while ((m = RE.exec(s)));
  return out + s.slice(last);
};

export { isDiagnostic, relocate } from "./core.js";

// The string accumulator is this edition's own shape, so its profile is stated
// here rather than named in the core: every node is shorter than an import of
// it, and the core stays the parser alone. `{{ }}` escapes at the markup edge;
// `{{{ }}}` is the same display text, verbatim.
export const { template, render } = make([
  (text) => (scope, acc) => (acc.text += text),
  (expr) => (scope, acc) => (acc.text += esc(display(expr(scope)))),
  (expr) => (scope, acc) => (acc.text += display(expr(scope))),
  () => ({ text: "" }),
  (acc) => acc.text,
]);
