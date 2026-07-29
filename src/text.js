/**
 * The plain-text edition: `{{ }}` interpolates unescaped and renders to a
 * string. Escaping belongs at the output edge, so there is no raw form —
 * `{{ }}` is already raw and `{{{ }}}` is a compile-time error.
 *
 * Definitionally `text(template(str)(values))` from the root entry, but built
 * as a string accumulator so casual string users never allocate tokens.
 */
import { make } from './core.js';

export { isDiagnostic } from './core.js';

export const { template, render } = make([
	s => (v, o) => { o.s += s; },
	e => (v, o, x) => (x = e(v), o.s += String(x ?? '')),
	0,
	() => ({ s: '' }),
	o => o.s,
]);
