/**
 * The token edition, and the engine proper: a template renders to a stream of
 * literal and value tokens. Escaping belongs to whoever consumes the stream,
 * so nothing here is HTML-aware and `{{{ }}}` has no meaning — `{{ }}` is
 * already raw.
 */
import { make } from './core.js';

export { isDiagnostic } from './core.js';

export const { template, render } = make([
	// Static text is a compile-time constant: hoist and freeze one token per
	// text node rather than allocating a fresh object every loop iteration.
	s => (t => (v, o) => { o.push(t); })(Object.freeze({ literal: s })),
	e => (v, o) => { o.push({ value: e(v) }); },
	0,
	() => [],
	o => o,
]);

/**
 * Join a token stream into the string `sjabloon/text` would have produced:
 * literals verbatim, values as `String(value ?? '')`.
 *
 * @param {readonly ({ literal: string } | { value: unknown })[]} tokens A render's output.
 * @returns {string} The joined text.
 */
export const text = tokens => {
	let s = '';
	for (const t of tokens) s += t.literal ?? String(t.value ?? '');
	return s;
};
