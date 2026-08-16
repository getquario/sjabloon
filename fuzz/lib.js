import { template as html } from '../lib/html.js';
import { template as root, text } from '../lib/index.js';
import { template as plain } from '../lib/text.js';

// Malformed templates and bad expressions surface as SyntaxError at compile
// time; anything else from template() is a real finding.
const isCompileErr = e => e instanceof SyntaxError;

// Rendering adds xprsn's runtime guard (TypeError) and, for pathological
// nesting, a stack-overflow RangeError. Everything else is unexpected.
const isRenderErr = e =>
	e instanceof SyntaxError ||
	e instanceof TypeError ||
	(e instanceof RangeError && /stack|Maximum call/i.test(String(e.message)));

export function compileOnly(src) {
	let raw = false;
	try { root(src); }
	catch (e) { if (!isCompileErr(e)) throw e; raw = e.code === 'SJABLOON_RAW_TAG'; }
	try { html(src); }
	catch (e) {
		if (!isCompileErr(e)) throw e;
		// Only the raw-less editions reject {{{ }}}; html owns that form.
		if (raw && e.code === 'SJABLOON_RAW_TAG') throw new Error('html rejected its own raw tag');
	}
}

export function renderSafe(src, values, funcs) {
	let a, b;
	try { a = root(src, funcs); b = plain(src, funcs); }
	catch (e) { if (!isCompileErr(e)) throw e; return; }
	// The token edition defers stringification, so it renders values the string
	// edition cannot convert to a primitive — the failure resurfaces at the
	// join instead. The invariant is therefore about text(tokens), not the raw
	// render: it must fail exactly when the string edition fails.
	let tokens, joined, str, tokenErr, strErr;
	try { tokens = a(values); } catch (e) { if (!isRenderErr(e)) throw e; tokenErr = e; }
	if (!tokenErr) {
		try { joined = text(tokens); } catch (e) { if (!isRenderErr(e)) throw e; tokenErr = e; }
	}
	try { str = b(values); } catch (e) { if (!isRenderErr(e)) throw e; strErr = e; }

	if ((tokenErr === undefined) !== (strErr === undefined)) throw new Error('text(tokens) and the string render disagree on failure');
	if (tokenErr) return;
	// Concatenation order IS token order, so this pins ordering completely;
	// all that is left for the loop below is the shape discriminant.
	if (joined !== str) throw new Error('text(tokens) diverged from the plain render');
	for (const t of tokens) {
		const lit = Object.hasOwn(t, 'literal');
		if (lit === Object.hasOwn(t, 'value')) throw new Error('token is neither or both forms');
		if (!lit) continue;
		if (typeof t.literal !== 'string' || !t.literal) throw new Error('empty or non-string literal token');
		if (!src.includes(t.literal)) throw new Error('literal token text is not in the template');
	}
}
