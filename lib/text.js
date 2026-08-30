/**
 * The plain-text edition: `{{ }}` interpolates unescaped and renders to a
 * string. Escaping belongs at the output edge, so there is no raw form —
 * `{{ }}` is already raw and `{{{ }}}` is a compile-time error.
 *
 * Definitionally `text(template(str)(values))` from the root entry, but built
 * as a string accumulator so casual string users never allocate tokens.
 */
import { display, make } from "./core.js";

export { isDiagnostic, relocate } from "./core.js";

// The string accumulator is this edition's own shape, so its profile is stated
// here rather than named in the core: every node is shorter than an import of
// it, and the core stays the parser alone.
export const { template, render } = make([
  (text) => (scope, acc) => (acc.text += text),
  (expr) => (scope, acc) => (acc.text += display(expr(scope))),
  0,
  () => ({ text: "" }),
  (acc) => acc.text,
]);
