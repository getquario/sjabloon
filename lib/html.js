/**
 * The HTML edition: `{{ }}` HTML-escapes, `{{{ }}}` interpolates raw. This is
 * 0.6's behaviour, kept for templates that target HTML directly. Everything
 * else in sjabloon is output-neutral; escaping lives here and nowhere else.
 */
import { display, litNode, make, strSeed, strTake, strVal } from "./core.js";

/** @type {Record<string, string>} */
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** The escaping `{{ }}` node — `strVal` escaped at the markup edge. @type {typeof strVal} */
const escVal = (expr) => (scope, acc) =>
  (acc.text += display(expr(scope)).replace(/[&<>"']/g, (c) => ESC[c]));

export { isDiagnostic, relocate } from "./core.js";

export const { template, render } = make([litNode, escVal, strVal, strSeed, strTake]);
