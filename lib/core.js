/**
 * Tiny, CSP-safe template engine powered by xprsn expressions.
 * Templates compile to a composition of closures; template text is never
 * turned into JavaScript, so strict CSP is satisfied.
 *
 * This is the shared core: the lexer, parser and diagnostics, with output left
 * to the profile each entry passes to `make()`. Exactly one copy of this module
 * backs every entry, so the WeakSet below authenticates diagnostics across all
 * of them.
 */
import { compile, isDiagnostic as isXprsnDiagnostic } from 'xprsn';

/**
 * @import { SjabloonDiagnostic, SjabloonErrorCode, SjabloonFunctions, SjabloonRenderer, SjabloonValues } from './types.js'
 * @template A
 * @typedef {(scope: any, acc: A, scratch?: any) => void} Node One compiled node: appends into
 *   `acc` and returns nothing. The third slot is a scratch local some editions declare as a
 *   parameter to save a `let`; callers pass two arguments.
 */

/**
 * One lexer token: `[0, text]` for a static run, or
 * `[1|2, body, start, end, bodyStart]` for a raw or normal tag.
 *
 * Deliberately loose — the two kinds have different arities and the parser
 * indexes them positionally on the hot path.
 *
 * @internal
 * @typedef {any[]} Tok
 */

const BLOCKED = /^(?:__proto__|constructor|prototype)$/;
/** @type {WeakSet<any>} */
const DIAGNOSTICS = new WeakSet();
const mark = DIAGNOSTICS.add.bind(DIAGNOSTICS);
const owns = DIAGNOSTICS.has.bind(DIAGNOSTICS);

/**
 * Check whether an error was produced or translated by sjabloon.
 *
 * Every entry shares one core, so a diagnostic thrown through any of them
 * authenticates through all of them.
 *
 * @param {unknown} error Any thrown value.
 * @returns {error is SjabloonDiagnostic} Whether `error` is an authentic sjabloon diagnostic.
 */
export const isDiagnostic = error => owns(error);

// Linear scan into text/tag/raw tokens. Dashes hug braces (`{{- x -}}` trims;
// `{{ -x }}` stays unary minus). Prefer {{{ }}} over {{ }}. `triple` latches
// off once }}} is gone so {{{...}}×N does not rescan to EOF (stays O(n)).
/**
 * @param {string} s
 * @returns {Tok[]}
 */
let lex = s => {
	const out = /** @type {Tok[]} */ ([]);
	for (let i = 0, triple = 1; i < s.length; ) {
		const a = s.indexOf('{{', i);
		if (a < 0) { out.push([0, s.slice(i)]); break; }
		if (a > i) out.push([0, s.slice(i, a)]);
		let raw = +(s[a + 2] === '{'), p = a + 2 + raw, l = s[p] === '-', b = -1;
		if (l) p++;
		if (raw && triple) { b = s.indexOf('}}}', p); if (b < 0) triple = 0; }
		if (b < 0) {
			if (raw) { raw = 0; p = a + 2; l = s[p] === '-'; if (l) p++; }
			b = s.indexOf('}}', p);
		}
		if (b < 0) { out.push([0, s.slice(a)]); break; }
		const r = b > p && s[b - 1] === '-';
		const q = r ? b - 1 : b, whole = s.slice(p, q), body = whole.trim();
		const start = p + whole.length - whole.trimStart().length, end = b + 2 + raw;
		const t = [raw ? 1 : 2, body, a, end, start];
		const prev = out.at(-1);
		if (l && prev?.[0] === 0 && prev[1]) prev[1] = prev[1].trimEnd();
		out.push(t);
		i = end;
		if (r) while (/\s/.test(s[i])) i++;
	}
	return out;
};

// One shared prototype for renders that omit `values` — the shape an embedder
// passing `{ root, item }` hits on every cell. A fresh `{}` here would give each
// wrapper its own hidden class, so lookups go megamorphic and such a render
// costs ~12x one that passes values. Frozen: nothing may write to a prototype
// shared across renders.
const EMPTY = Object.freeze({});

// Shared parser state; parsing is synchronous so this is safe.
// `nms` collects free variables, `fnms` the registry functions called.
// LIT/VAL/RAW are the compiling profile's node builders — read only while
// parsing, never at render time, so the hot path stays free of indirection.
/** @type {Tok[]} */
let toks;
/** @type {number} */
let i;
/** @type {SjabloonFunctions | undefined} */
let fns;
/** @type {Tok} */
let last;
/** @type {string[]} */
let bound;
/** @type {Set<string>} */
let nms;
/** @type {Set<string>} */
let fnms;
/** @type {string} */
let src;
/** @type {any[]} */
let blocks;
// The profile's node builders. `any` rather than `Node<A>`: `make()` is generic
// per edition, but these are module-level and shared across all three, so no
// single A applies here.
/** @type {any} */
let LIT;
/** @type {any} */
let VAL;
/** @type {any} */
let RAW;

let snap = () => Object.freeze(blocks.slice());
// Block nesting is capped so a pathological template fails as a deterministic
// SyntaxError at the offending opener, far below the native stack limit.
const DEPTH = 256;
/**
 * @param {string} type
 * @param {Tok} t
 */
let opener = (type, t) => {
	blocks.length < DEPTH || fault('Template too deeply nested', 'SJABLOON_TOO_DEEP', t); // oxlint-disable-line no-unused-expressions
	return Object.freeze({ type, start: t[2], end: t[3] });
};
/**
 * @template {object} E
 * @param {E} e
 * @param {any} context
 * @returns {E}
 */
let attach = (e, context) => {
	Object.defineProperty(e, 'blocks', { value: context, enumerable: true });
	mark(e);
	return e;
};
/**
 * Throw a located compile-time diagnostic. `code` is typed to the published
 * union, so a code that is not declared in `types.d.ts` fails to compile here
 * rather than shipping undeclared — which is exactly how SJABLOON_TOO_DEEP got
 * out for two releases.
 *
 * @param {string} msg
 * @param {SjabloonErrorCode} code
 * @param {any[]} [t] The token to point at; omitted for end-of-source faults.
 * @returns {never}
 */
const fault = (msg, code, t, start = t?.[2] ?? src.length, end = t?.[3] ?? src.length) => {
	const e = /** @type {SyntaxError & { code: SjabloonErrorCode, start: number, end: number }} */ (SyntaxError(msg));
	e.code = code;
	e.start = start;
	e.end = end;
	throw attach(e, snap());
};
/**
 * Re-locate a diagnostic thrown by a nested compile or render into this
 * template's coordinates, then rethrow it as ours. Always throws.
 *
 * `owns` is a plain predicate rather than a type guard: `e` is retyped here,
 * not narrowed. `const` with an explicit `never` type is what lets callers
 * treat the catch block as terminal.
 *
 * @type {(e: any, start: number, context: any, owns?: (e: unknown) => boolean) => never}
 */
const translated = (e, start, context, owns = isXprsnDiagnostic) => {
	if (!owns(e)) throw e;
	e.start += start;
	e.end += start;
	throw attach(e, context);
};
/**
 * @param {Tok} t
 * @returns {never}
 */
let unexpected = t => fault('Unexpected {{' + t[1] + '}}', 'SJABLOON_UNEXPECTED_TAG', t);

// Append every node's output into the accumulator `o`, which the root wrapper
// creates once per render and threads all the way down. Nodes return nothing:
// no intermediate array per node list, no join, and render order is just push
// order.
/**
 * @param {Node<any>[]} nodes
 * @param {any} v
 * @param {any} o
 */
let run = (nodes, v, o) => { for (const n of nodes) n(v, o); };

// A leaf interpolation node: compile the expression, then let the profile turn
// the evaluated value into output. `k` is VAL for `{{ }}`, RAW for `{{{ }}}`.
/**
 * @param {Tok} t
 * @param {any} k
 * @returns {Node<any>}
 */
let interp = (t, k) => k(cp(t[1], t[4], snap()));

// Compile one expression and collect its free variables (minus the loop
// variables currently in scope, which belong to the template) and the registry
// functions it calls.
/**
 * @param {string} s
 * @param {number} start
 * @param {any} context
 * @returns {(v: any) => any}
 */
let cp = (s, start, context) => {
	/** @type {ReturnType<typeof compile>} */
	let e;
	try {
		// `SjabloonFunctions` is `Record<string, Function>`; xprsn's registry wants
		// `Record<string, (...args: any[]) => any>`, and TypeScript deliberately
		// refuses `Function` against a call signature. The registry is passed
		// straight through untouched, so this is a published-type mismatch rather
		// than a real one — narrowing `SjabloonFunctions` would change the API.
		e = compile(s, /** @type {any} */ (fns));
	} catch (x) {
		translated(x, start, context);
	}
	for (const n of e.names) bound.includes(n) || nms.add(n); // oxlint-disable-line no-unused-expressions
	for (const fn of e.functions) fnms.add(fn);
	return v => {
		try {
			return e(v);
		} catch (x) {
			translated(x, start, context, e.isDiagnostic);
		}
	};
};

// One `#if`/`#elif` link: parse its branch, then recurse on the chain tail.
/**
 * @param {(v: any) => any} cond
 * @returns {Node<any>}
 */
let branch = cond => {
	const then = parse(['#elif', '#else', '/if']);
	const tag = last[1];
	let els = /** @type {Node<any>[]} */ ([]);
	if (tag.startsWith('#elif ')) els = [branch(cp(tag.slice(6), last[4] + 6, snap()))];
	else if (tag === '#else') {
		els = parse(['/if']);
		last[1] === '/if' || unexpected(last); // oxlint-disable-line no-unused-expressions
	} else if (tag !== '/if') unexpected(last);
	return (v, o) => run(cond(v) ? then : els, v, o);
};

/**
 * @param {string[]} stops
 * @returns {Node<any>[]}
 */
let parse = stops => {
	const nodes = /** @type {Node<any>[]} */ ([]);
	for (let t; (t = toks[i++]); ) {
		const tag = t[1];
		if (!t[0]) {
			// Left-trim can shave a text run down to nothing; never emit it.
			tag && nodes.push(LIT(tag)); // oxlint-disable-line no-unused-expressions
		} else if (t[0] === 1) {
			// The lexer always tokenizes `}}}` — dropping it would cost the
			// `triple` latch that keeps lexing linear — so editions without a
			// raw form reject it here, at the parser, with a located span.
			RAW || fault('Raw {{{' + tag + '}}} is not available here; {{ ' + tag + ' }} is already raw', 'SJABLOON_RAW_TAG', t); // oxlint-disable-line no-unused-expressions
			nodes.push(interp(t, RAW));
		} else if (stops.includes(tag.split(' ')[0])) {
			last = t;
			return nodes;
		} else if (tag[0] === '!') {
			// comment
		} else if (tag.startsWith('#if ')) {
			blocks.push(opener('if', t));
			nodes.push(branch(cp(tag.slice(4), t[4] + 4, snap())));
			blocks.pop();
		} else if (/^#each(?:\s|$)/.test(tag)) {
			blocks.push(opener('each', t));
			// `|| fault()` in the initializer, not as a follow-up statement: fault
			// returns never, so `m` is non-null from here without a second check.
			const m = /^#each ([\s\S]+) as ((\w+)(?:\s*,\s*(\w+))?)$/.exec(tag) || fault('Bad {{' + tag + '}}', 'SJABLOON_EACH_SYNTAX', t);
			const name = m[3], idx = m[4], at = t[4] + tag.length - m[2].length;
			if (BLOCKED.test(name)) fault('Bad {{' + tag + '}}', 'SJABLOON_BLOCKED_BINDING', t, at, at + name.length);
			if (idx && BLOCKED.test(idx)) {
				const p = t[4] + tag.length - idx.length;
				fault('Bad {{' + tag + '}}', 'SJABLOON_BLOCKED_BINDING', t, p, p + idx.length);
			}
			const list = cp(m[1], t[4] + 6, snap());
			// `name`, `idx`, and `loop` are engine-bound inside the body, so
			// exclude them from names there and restore outer bindings after.
			const mark = bound.length;
			bound.push(name);
			if (idx) bound.push(idx);
			bound.push('loop');
			const body = parse(['#else', '/each']);
			bound.length = mark;
			let empty = /** @type {Node<any>[]} */ ([]);
			if (last[1] === '#else') {
				empty = parse(['/each']);
				last[1] === '/each' || unexpected(last); // oxlint-disable-line no-unused-expressions
			} else if (last[1] !== '/each') unexpected(last);
			blocks.pop();
			// Child scopes inherit the parent via the prototype chain, so outer
			// variables stay visible inside the loop body. `@` re-points to the
			// current item at each level, `$` (root) rides the chain, and `loop`
			// carries the iteration metadata (index/first/last/length).
			nodes.push((v, o) => {
				const lv = list(v), arr = Array.isArray(lv);
				const ps = arr ? lv.slice() : lv && typeof lv === 'object' ? Object.keys(lv).map(k => [lv[k], k]) : [];
				if (!ps.length) return run(empty, v, o);
				// forEach, not a counted loop: `slice()` keeps holes and forEach
				// skips them exactly as the `.map()` this replaced did, so sparse
				// arrays iterate the same way with surrounding indexes unshifted.
				ps.forEach((x, j) => {
					const item = arr ? x : x[0], key = arr ? j : x[1];
					const s = Object.create(v);
					s[name] = item;
					if (idx) s[idx] = key;
					s['@'] = item;
					s.loop = { index: j + 1, index0: j, first: !j, last: j === ps.length - 1, length: ps.length };
					run(body, s, o);
				});
			});
		} else if (/^#(?:if|elif|else)(?:\s|$)/.test(tag) || tag[0] === '/') {
			unexpected(t);
		} else if (tag[0] === '#') {
			fault('Unknown {{' + tag + '}}', 'SJABLOON_UNKNOWN_BLOCK', t);
		} else {
			nodes.push(interp(t, VAL));
		}
	}
	stops.length && fault('Missing {{' + stops[stops.length - 1] + '}}', 'SJABLOON_UNCLOSED_BLOCK'); // oxlint-disable-line no-unused-expressions
	return nodes;
};

/**
 * Bind the parser to an output profile. Each edition calls this once at module
 * load and gets back its own `template` and `render`; the parser itself stays
 * module-level and shared, so there is exactly one diagnostics WeakSet.
 *
 * `template(str, funcs?)` compiles a template once, to render it many times.
 *
 * The returned renderer exposes `names`: the variables the template reads
 * from your values, deduplicated. Loop variables the template introduces are
 * not included. It also exposes `functions`: the registry functions the
 * template calls, deduplicated.
 *
 * Two anchors are always in scope: `$` is the root values, and `@` is the
 * current `#each` item (the root outside any loop). They let a nested loop
 * reach the root (`$.company`) or the current item (`@.total`) explicitly,
 * past any shadowing. Neither counts as a `name`.
 *
 * An embedder with its own scope model can override the anchors per render by
 * passing `{ root, item }` as the renderer's second argument: `$` becomes
 * `root` and `@` becomes `item` (two distinct objects). Omit `item` to leave
 * `@` unbound, so reading `@.x` throws through xprsn's guard.
 *
 * Render order is push order into a single accumulator: loop bodies append once
 * per iteration, untaken branches append nothing, and block expressions (`#if`
 * conditions, `#each` collections) never append at all. The token edition
 * exposes that ordering directly; the string editions collapse it to text.
 *
 * A profile is `[lit, val, raw, seed, take]`:
 *   lit(text)  node emitting one static text run
 *   val(expr)  node emitting a `{{ }}` interpolation
 *   raw(expr)  node emitting a `{{{ }}}` interpolation
 *   seed()     a fresh output accumulator, one per render
 *   take(acc)  the render's return value
 * Nodes are `(scope, acc) => void`; see run().
 *
 * @template A The accumulator this edition threads through its nodes.
 * @template T What one render returns.
 * @param {[
 *   lit: (text: string) => Node<A>,
 *   val: (expr: (scope: any) => any) => Node<A>,
 *   raw: ((expr: (scope: any) => any) => Node<A>) | 0,
 *   seed: () => A,
 *   take: (acc: A) => T,
 * ]} profile The output profile, as above.
 * @returns {{
 *   template: (str: string, funcs?: SjabloonFunctions) => SjabloonRenderer<T>,
 *   render: (str: string, values?: SjabloonValues, funcs?: SjabloonFunctions) => T,
 * }} That edition's API.
 * @throws {SyntaxError} `template` throws on malformed tags, unclosed blocks,
 *   or bad expressions.
 */
export let make = ([lit, val, raw, seed, take]) => {
	/**
	 * @param {string} str
	 * @param {SjabloonFunctions} [funcs]
	 * @returns {SjabloonRenderer<T>}
	 */
	function template(str, funcs) {
		LIT = lit, VAL = val, RAW = raw; // oxlint-disable-line no-unused-expressions
		fns = funcs;
		// `$` (root) and `@` (current item) are engine-bound anchors, always in
		// scope, so they never count as caller-supplied `names`.
		bound = ['$', '@'];
		nms = new Set();
		fnms = new Set();
		src = String(str);
		blocks = [];
		toks = lex(src);
		i = 0;
		// Deeply nested blocks overflow the recursive-descent parser; surface that
		// as a SyntaxError so malformed input keeps its documented compile-time
		// contract (mirroring xprsn's XPRSN_TOO_DEEP for expressions).
		let nodes;
		try {
			nodes = parse([]);
		} catch (x) {
			// An empty span at the end, like an unclosed block.
			if (x instanceof RangeError) fault('Template too deeply nested', 'SJABLOON_TOO_DEEP');
			throw x;
		}
		// Wrap the values in a root scope carrying the anchors, without mutating
		// what the caller passed: by default `$` and `@` both point at the root.
		// An embedder can override the anchors with a `{ root, item }` second arg:
		// `$` = root, `@` = item (distinct objects). Omitting `item` leaves `@`
		// unbound, so `@.x` throws through xprsn's guard — a group-header band that
		// has no current row wants exactly that.
		const f = (/** @type {any} */ v, /** @type {any} */ o) => {
			v = v || EMPTY;
			const r = Object.create(v);
			r['$'] = o ? o.root : v;
			if (!o) r['@'] = v;
			else if ('item' in o) r['@'] = o.item;
			// One accumulator per render, owned here and threaded down. A registry
			// function that renders another template gets its own, so re-entrancy
			// needs no bookkeeping.
			const acc = seed();
			run(nodes, r, acc);
			return take(acc);
		};
		// Array.from, not a spread: the bundler's transpile turns `[...set]` into
		// `[].concat(set)`, which wraps the Set instead of unpacking it.
		f.names = Array.from(nms);
		f.functions = Array.from(fnms);
		return f;
	}
	return { template, render: (str, values, funcs) => template(str, funcs)(values) };
};
