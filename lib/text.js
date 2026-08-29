/**
 * The plain-text edition: `{{ }}` interpolates unescaped and renders to a
 * string. Escaping belongs at the output edge, so there is no raw form —
 * `{{ }}` is already raw and `{{{ }}}` is a compile-time error.
 *
 * Definitionally `text(template(str)(values))` from the root entry, but built
 * as a string accumulator so casual string users never allocate tokens.
 */
import { display, litNode, make } from "./core.js";

export { isDiagnostic, relocate } from "./core.js";

export const { template, render } = make([
  litNode,
  (expr) => (scope, acc, value) => ((value = expr(scope)), (acc.text += display(value))),
  0,
  () => ({ text: "" }),
  (acc) => acc.text,
]);
