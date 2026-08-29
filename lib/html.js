/**
 * The HTML edition: `{{ }}` HTML-escapes, `{{{ }}}` interpolates raw. This is
 * 0.6's behaviour, kept for templates that target HTML directly. Everything
 * else in sjabloon is output-neutral; escaping lives here and nowhere else.
 */
import { display, litNode, make } from "./core.js";

/** @type {Record<string, string>} */
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** @param {string} s Already display text — both call sites pass `display()`. */
const esc = (s) => s.replace(/[&<>"']/g, (c) => ESC[c]);

export { isDiagnostic, relocate } from "./core.js";

export const { template, render } = make([
  litNode,
  (expr) => (scope, acc, value) => ((value = expr(scope)), (acc.text += esc(display(value)))),
  (expr) => (scope, acc, value) => ((value = expr(scope)), (acc.text += display(value))),
  () => ({ text: "" }),
  (acc) => acc.text,
]);
