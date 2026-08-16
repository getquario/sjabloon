/**
 * The HTML edition: `{{ }}` HTML-escapes, `{{{ }}}` interpolates raw. This is
 * 0.6's behaviour, kept for templates that target HTML directly. Everything
 * else in sjabloon is output-neutral; escaping lives here and nowhere else.
 */
import { make } from "./core.js";

/** @type {Record<string, string>} */
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** @param {any} s */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

export { isDiagnostic } from "./core.js";

export const { template, render } = make([
  (text) => (scope, acc) => {
    acc.text += text;
  },
  (expr) => (scope, acc, value) => ((value = expr(scope)), (acc.text += esc(value ?? ""))),
  (expr) => (scope, acc, value) => ((value = expr(scope)), (acc.text += String(value ?? ""))),
  () => ({ text: "" }),
  (acc) => acc.text,
]);
