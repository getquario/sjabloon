/**
 * The HTML edition: `{{ }}` HTML-escapes, `{{{ }}}` interpolates raw. This is
 * 0.6's behaviour, kept for templates that target HTML directly. Everything
 * else in sjabloon is output-neutral; escaping lives here and nowhere else.
 */
import { display, litNode, make, strSeed, strTake, strVal } from "./core.js";

/** @type {Record<string, string>} */
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** @param {string} s Already display text — the node below passes `display()`. */
const esc = (s) => s.replace(/[&<>"']/g, (c) => ESC[c]);
/** The escaping `{{ }}` node — `strVal` with `esc` at the markup edge. @type {typeof strVal} */
const escVal = (expr) => (scope, acc) => (acc.text += esc(display(expr(scope))));

export { isDiagnostic, relocate } from "./core.js";

export const { template, render } = make([litNode, escVal, strVal, strSeed, strTake]);
