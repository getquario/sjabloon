/**
 * The HTML edition: `{{ }}` HTML-escapes, `{{{ }}}` interpolates raw. This is
 * 0.6's behaviour, kept for templates that target HTML directly. Everything
 * else in sjabloon is output-neutral; escaping lives here and nowhere else.
 */
import { make } from './core.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s).replace(/[&<>"']/g, c => ESC[c]);

export { isDiagnostic } from './core.js';

export const { template, render } = make([
	s => (v, o) => { o.s += s; },
	e => (v, o, x) => (x = e(v), o.s += esc(x ?? '')),
	e => (v, o, x) => (x = e(v), o.s += String(x ?? '')),
	() => ({ s: '' }),
	o => o.s,
]);
