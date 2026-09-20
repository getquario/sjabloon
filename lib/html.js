/**
 * The HTML edition: `{{ }}` HTML-escapes, `{{{ }}}` interpolates raw.
 * Everything else in sjabloon is output-neutral; escaping lives here and
 * nowhere else.
 */
import { display, make } from "./core.js";

/** @type {Record<string, string>} */
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const RE = /[&<>"']/g;

/**
 * HTML-escape one display string.
 *
 * The regex drives the scan and the pieces are sliced out around each match:
 * a `replace` callback pays a JS call per escapable character, a `charCodeAt`
 * walk one per character. Values needing no escaping leave on the first `exec`.
 *
 * The walk drains the regex to `null`, leaving `lastIndex` at 0. Resetting it
 * on entry covers the one way out that does not — a throw part way through,
 * which would leave this shared regex primed for the next value.
 *
 * @param {string} s One value's display text.
 * @returns {string} The same text with `& < > " '` replaced by entities.
 */
const esc = (s) => {
  RE.lastIndex = 0;
  let m,
    out = "",
    last = 0;
  while ((m = RE.exec(s))) {
    out += s.slice(last, m.index) + ESC[m[0]];
    last = m.index + 1;
  }
  return last ? out + s.slice(last) : s;
};

export { isDiagnostic, relocate } from "./core.js";

// The profile is stated here rather than named in the core: every node is
// shorter than an import of it, and the core stays the parser alone.
// `{{ }}` escapes at the markup edge; `{{{ }}}` is the same text, verbatim.
export const { template, render } = make([
  (text) => (scope, acc) => (acc.text += text),
  (expr) => (scope, acc) => (acc.text += esc(display(expr(scope)))),
  (expr) => (scope, acc) => (acc.text += display(expr(scope))),
  () => ({ text: "" }),
  (acc) => acc.text,
]);
