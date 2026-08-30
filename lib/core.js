/**
 * Tiny, CSP-safe template engine powered by xprsn expressions.
 * Templates compile to a composition of closures; template text is never
 * turned into JavaScript, so strict CSP is satisfied.
 *
 * This is the shared core: the lexer, parser and diagnostics, with output left
 * to the profile each entry passes to `make()`. Exactly one copy of this module
 * backs every entry, so the diagnostics store below authenticates diagnostics
 * across all of them.
 */
import { adopt, mint, relocate as relocateFault, store } from "waarmerk";
import { compile, isDiagnostic as isXprsnDiagnostic, relocate as relocateXprsn } from "xprsn";

/**
 * @import { SjabloonDiagnostic, SjabloonErrorCode, SjabloonFunctions, SjabloonRenderer, SjabloonValues } from './types.js'
 * @import { Relocation, Store } from 'waarmerk'
 * @import { XprsnErrorCode } from 'xprsn'
 * @template A
 * @typedef {(scope: any, acc: A) => void} Node One compiled node: appends into
 *   `acc` and returns nothing.
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

/**
 * This module's identity, carrying its code union. Naming the union here is
 * what puts every code below under `tsc`: waarmerk checks a code against the
 * store it is thrown into, so one this module does not declare fails at the
 * line that throws it rather than shipping — which is how SJABLOON_TOO_DEEP
 * got out for two releases.
 *
 * The union is spelled with xprsn's beside this module's own, because most
 * diagnostics here are xprsn errors translated into template coordinates.
 * Saying so here is what makes `SjabloonDiagnostic.code` true by construction,
 * and it keeps `SjabloonErrorCode` meaning what its siblings' unions mean: the
 * codes this package mints. The store's value is the per-template origin each
 * renderer's own `isDiagnostic` compares against.
 *
 * @type {Store<SjabloonErrorCode | XprsnErrorCode>}
 */
const diags = store("sjabloon");

/**
 * Check whether an error was produced or translated by sjabloon.
 *
 * Every entry shares one core, so a diagnostic thrown through any of them
 * authenticates through all of them.
 */
export const isDiagnostic = diags.isDiagnostic;

/**
 * Copy a diagnostic into an embedder's coordinates.
 *
 * Most diagnostics here are xprsn errors translated into template coordinates,
 * and those are registered in both stores. Letting xprsn make that half of the
 * copy is what keeps the copy registered in both — the same reason relocation
 * lives with authentication in the first place. `adopt` with no fields then,
 * not with `blocks`: the descriptors already carried that across, and defining
 * it again would redefine a non-configurable property.
 *
 * @param {unknown} diag A diagnostic produced or translated by sjabloon.
 * @param {Relocation} [opts]
 * @returns {SjabloonDiagnostic} The relocated copy.
 * @throws {TypeError} When `diag` is not a sjabloon diagnostic.
 */
export const relocate = (diag, opts) => {
  const d = /** @type {any} */ (diag);
  return /** @type {any} */ (
    isXprsnDiagnostic(d)
      ? adopt(diags, relocateXprsn(d, opts), undefined, diags.origin(d))
      : relocateFault(diags, d, opts)
  );
};

// Linear scan into text/tag/raw tokens. Dashes hug braces (`{{- x -}}` trims;
// `{{ -x }}` stays unary minus). Prefer {{{ }}} over {{ }}. `triple` latches
// off once }}} is gone so {{{...}}×N does not rescan to EOF (stays O(n)).

// One shared prototype for renders that omit `values` — the shape an embedder
// passing `{ root, item }` hits on every cell. A fresh `{}` here would give each
// wrapper its own hidden class, so lookups go megamorphic and such a render
// costs ~12x one that passes values. Frozen: nothing may write to a prototype
// shared across renders.
const EMPTY = Object.freeze({});

// Shared parser state; parsing is synchronous so this is safe.
// LIT/VAL/RAW are the compiling profile's node builders — read only while
// parsing, never at render time, so the hot path stays free of indirection.
// `nest` is the nesting budget shared by `#if`/`#each`/`#elif` (see opener).
let /** @type {Tok[]} */ tokens, /** @type {Tok} */ last, /** @type {string} */ source;
let /** @type {number} */ i, /** @type {number} */ nest;
let /** @type {SjabloonFunctions | undefined} */ fns, /** @type {string[]} */ bound;
let /** @type {Set<string>} */ names, /** @type {Set<string>} */ functions;
/** @type {{ name: string, start: number, end: number }[]} */
let reads;
/** @type {{ type: string, start: number, end: number }[]} */
let blocks;
// The profile's node builders. `any` rather than `Node<A>`: `make()` is generic
// per edition, but these are module-level and shared across all three, so no
// single A applies here.
let /** @type {any} */ LIT, /** @type {any} */ VAL, /** @type {any} */ RAW;
let lexTriple = 1,
  lxRaw = 0,
  lxP = 0,
  lxL = 0,
  lxB = 0;

/** @param {number} a */
let findEnd = (a) => {
  lxB = lxRaw & lexTriple ? source.indexOf("}}}", lxP) : -1;
  // oxlint-disable-next-line no-unused-expressions
  lxB < 0 &&
    (lxRaw &&
      ((lexTriple = 0), (lxRaw = 0), (lxP = a + 2), (lxL = +(source[lxP] === "-")), (lxP += lxL)),
    (lxB = source.indexOf("}}", lxP)));
};

let trimPrev = (prev = tokens.at(-1)) => {
  // oxlint-disable-next-line no-unused-expressions
  prev && prev[0] === 0 && prev[1] && (prev[1] = prev[1].trimEnd());
};

/** @param {number} a */
let takeScanned = (a) => {
  const r = +(lxB > lxP) & +(source[lxB - 1] === "-"),
    whole = source.slice(lxP, lxB - r),
    body = whole.trim(),
    start = lxP + whole.length - whole.trimStart().length,
    end = lxB + 2 + lxRaw;
  // oxlint-disable-next-line no-unused-expressions
  lxL && trimPrev();
  tokens.push([2 - lxRaw, body, a, end, start]);
  i = end;
  if (r) while (/\s/.test(source[i])) i++;
};

/** @param {number} [a] */
let lexStep = (a = source.indexOf("{{", i)) => {
  if (a >= 0) {
    if (a > i) tokens.push([0, source.slice(i, a)]);
    lxRaw = +(source[a + 2] === "{");
    lxP = a + 2 + lxRaw;
    lxL = +(source[lxP] === "-");
    lxP += lxL;
    findEnd(a);
    if (lxB >= 0) return (takeScanned(a), 1);
    // An opener with no closer is text from its own `{{` on: rewind to it and
    // fall into the shared tail below.
    i = a;
  }
  // Both dead ends end the scan the same way — the rest of the source is one
  // final text token.
  return (tokens.push([0, source.slice(i)]), 0);
};

let snap = () => Object.freeze(blocks.slice());
/**
 * Mint one block frame. Nesting is capped at 256 so a pathological template
 * fails as a deterministic SyntaxError at the offending opener, far below the
 * native stack limit.
 *
 * @param {string} type
 * @param {Tok} t
 */
let opener = (type, t) => {
  // oxlint-disable-next-line no-unused-expressions
  nest < 256 || fault("Template too deeply nested", "SJABLOON_TOO_DEEP", t);
  nest++;
  return Object.freeze({ type, start: t[2], end: t[3] });
};
/**
 * Throw a located compile-time diagnostic. `code` is typed to the published
 * union, so a code that is not declared in `types.d.ts` fails to compile here
 * rather than shipping undeclared — which is exactly how SJABLOON_TOO_DEEP got
 * out for two releases.
 *
 * @param {string} msg
 * @param {SjabloonErrorCode} code
 * @param {any[]} [t] The token to point at; defaults to an end-of-source point.
 * @returns {never}
 */
const fault = (msg, code, t = [0, 0, source.length, source.length], start = t[2], end = t[3]) =>
  mint(diags, SyntaxError, msg, { code, start, end, blocks: snap() }, names);
/**
 * Re-locate a diagnostic thrown by a nested compile or render into this
 * template's coordinates, then rethrow it as ours. Always throws.
 *
 * `guard` is a plain predicate rather than a type guard: `e` is retyped here,
 * not narrowed. `const` with an explicit `never` type is what lets callers
 * treat the catch block as terminal.
 *
 * @type {(e: any, start: number, context: any, own: any,
 *   guard?: (e: unknown) => boolean) => never}
 */
const translated = (e, start, context, own, guard = isXprsnDiagnostic) => {
  if (!guard(e)) throw e;
  throw adopt(diags, relocateXprsn(e, { offset: start }), { blocks: context }, own);
};
/**
 * @param {Tok} t
 * @returns {never}
 */
let unexpected = (t) => fault("Unexpected {{" + t[1] + "}}", "SJABLOON_UNEXPECTED_TAG", t);

// Append every node's output into the accumulator `acc`, which the root wrapper
// creates once per render and threads all the way down. Nodes return nothing:
// no intermediate array per node list, no join, and render order is just push
// order.
/**
 * @param {Node<any>[]} nodes
 * @param {any} scope
 * @param {any} acc
 */
let run = (nodes, scope, acc) => {
  for (const n of nodes) n(scope, acc);
};

// Compile one expression and collect its free variables (minus the loop
// variables currently in scope, which belong to the template) and the registry
// functions it calls.
/**
 * @param {string} expr
 * @param {number} start
 * @param {any} [context] The block context this expression sits in; every
 *   caller wants the frames as they stand at the call, so it defaults to them.
 * @returns {(v: any) => any}
 */
let compileExpr = (expr, start, context = snap()) => {
  // The compiling template's origin, captured now: the render-time catch below
  // runs long after the module-level `names` has moved on to other compiles.
  const own = names;
  /** @type {ReturnType<typeof compile>} */
  let e;
  try {
    // `SjabloonFunctions` is `Record<string, Function>`; xprsn's registry wants
    // `Record<string, (...args: any[]) => any>`, and TypeScript deliberately
    // refuses `Function` against a call signature. The registry is passed
    // straight through untouched, so this is a published-type mismatch rather
    // than a real one — narrowing `SjabloonFunctions` would change the API.
    e = compile(expr, /** @type {any} */ (fns));
  } catch (x) {
    translated(x, start, context, own);
  }
  e.names.forEach((n) => {
    // oxlint-disable-next-line no-unused-expressions
    bound.includes(n) || names.add(n);
  });
  // Every read, shifted into template coordinates — bound names and loop
  // variables included; `names` above stays the free, deduplicated view.
  for (const r of e.reads) reads.push({ name: r.name, start: start + r.start, end: start + r.end });
  for (const fn of e.functions) functions.add(fn);
  return (v) => {
    try {
      return e(v);
    } catch (x) {
      // Read off the compiled expression to pass along, never called through
      // `e` — xprsn's `isDiagnostic` is a closure over its store, not a method.
      // oxlint-disable-next-line typescript/unbound-method
      translated(x, start, context, own, e.isDiagnostic);
    }
  };
};

/**
 * The shared else tail of `#if` and `#each`. An `{{#else}}` parses one more
 * branch; with or without one, the tag standing here has to be the closer, and
 * anything else is an unexpected tag either way — so both paths leave through
 * the one check below, and the else branch is whatever was parsed or nothing.
 *
 * @param {string} close
 * @param {Node<any>[]} [nodes]
 * @returns {Node<any>[]}
 */
let elseTail = (close, nodes = []) => {
  // oxlint-disable-next-line no-unused-expressions
  last[1] === "#else" && (nodes = parse([close]));
  return last[1] === close ? nodes : unexpected(last);
};

/**
 * One `#if` branch and whatever hangs off it. An `{{#elif}}` link is itself a
 * branch, so the chain tail recurses straight back in here rather than through
 * a helper. Elif links share the nest budget so they fail closed before the
 * native stack, and the block `opener` mints for one is discarded, never
 * pushed: an elif link must not appear as an extra `#if` frame in diagnostic
 * context. `t` doubles as the scratch slot for the link it builds.
 *
 * @param {(v: any) => any} cond
 * @param {Node<any>[]} [then]
 * @param {any} [t]
 * @param {any} [els]
 * @returns {Node<any>}
 */
let branch =
  (
    cond,
    then = parse(["/if", "#elif", "#else"]),
    t = last,
    els = t[1].startsWith("#elif ")
      ? (opener("elif", t), (t = branch(compileExpr(t[1].slice(6), t[4] + 6))), nest--, [t])
      : elseTail("/if"),
  ) =>
  (scope, acc) =>
    run(cond(scope) ? then : els, scope, acc);

/**
 * What one `#each` walks: the values themselves for an array, the own keys for
 * an object. The caller has already asked whether the collection is an array —
 * that answer decides the key shape too, so it is passed in rather than asked
 * twice, and it is what tells the loop whether an element is a value or a key
 * to index back through. No pair array is built: the key list is the walk.
 *
 * @param {any} listValue
 * @param {boolean} arr
 * @returns {any[]}
 */
let eachPairs = (listValue, arr) =>
  arr
    ? listValue.slice()
    : listValue && typeof listValue === "object"
      ? Object.keys(listValue)
      : [];

/**
 * @param {Tok} t
 * @param {string} tag
 * @param {string} name
 * @param {number} at
 */
let checkBinding = (t, tag, name, at) => {
  // oxlint-disable-next-line no-unused-expressions
  /^(?:__proto__|constructor|prototype)$/.test(name) &&
    fault("Bad {{" + tag + "}}", "SJABLOON_BLOCKED_BINDING", t, at, at + name.length);
};

/**
 * @param {Tok} t
 * @param {string} tag
 * @param {Node<any>[]} nodes
 */
let parseEach = (t, tag, nodes) => {
  blocks.push(opener("each", t));
  const m =
    /^#each ([\s\S]+) as ((\w+)(?:\s*,\s*(\w+))?)$/.exec(tag) ||
    fault("Bad {{" + tag + "}}", "SJABLOON_EACH_SYNTAX", t);
  const name = m[3],
    idx = m[4],
    at = t[4] + tag.length - m[2].length;
  checkBinding(t, tag, name, at);
  const list = compileExpr(m[1], t[4] + 6);
  const mark = bound.length;
  bound.push(name);
  if (idx) {
    checkBinding(t, tag, idx, t[4] + tag.length - idx.length);
    bound.push(idx);
  }
  bound.push("loop");
  const body = parse(["/each", "#else"]);
  bound.length = mark;
  const empty = elseTail("/each");
  blocks.pop();
  nest--;
  nodes.push((scope, acc) => {
    const listValue = list(scope),
      arr = Array.isArray(listValue);
    const pairs = eachPairs(listValue, arr);
    if (!pairs.length) return run(empty, scope, acc);
    pairs.forEach((x, j) => {
      const child = Object.create(scope);
      // The loop variable and the `@` anchor name the same element, so one
      // write lands in both slots. `x` is the element itself for an array and
      // the own key to index back through for an object; the index variable,
      // wanted only when the template declared one, is the mirror of that.
      child[name] = child["@"] = arr ? x : listValue[x];
      if (idx) child[idx] = arr ? j : x;
      child.loop = {
        index: j + 1,
        index0: j,
        first: !j,
        last: j === pairs.length - 1,
        length: pairs.length,
      };
      run(body, child, acc);
    });
  });
};

/**
 * @param {Tok} t
 * @param {Node<any>[]} nodes
 */
let emitLeaf = (t, nodes) => {
  if (!t[0]) {
    // oxlint-disable-next-line no-unused-expressions
    t[1] && nodes.push(LIT(t[1]));
    return;
  }
  // oxlint-disable-next-line no-unused-expressions
  RAW ||
    fault(
      "Raw {{{" + t[1] + "}}} is not available here; {{ " + t[1] + " }} is already raw",
      "SJABLOON_RAW_TAG",
      t,
    );
  nodes.push(RAW(compileExpr(t[1], t[4])));
};

/**
 * @param {Tok} t
 * @param {string} tag
 * @param {Node<any>[]} nodes
 */
let emitBlock = (t, tag, nodes) => {
  if (tag.startsWith("#if ")) {
    blocks.push(opener("if", t));
    nodes.push(branch(compileExpr(tag.slice(4), t[4] + 4)));
    blocks.pop();
    nest--;
    return;
  }
  if (/^#each(?:\s|$)/.test(tag)) return parseEach(t, tag, nodes);
  if (/^#(?:if|elif|else)(?:\s|$)/.test(tag)) unexpected(t);
  fault("Unknown {{" + tag + "}}", "SJABLOON_UNKNOWN_BLOCK", t);
};

/**
 * @param {Tok} t
 * @param {string} tag
 * @param {Node<any>[]} nodes
 */
let emitTag = (t, tag, nodes) => {
  if (tag[0] === "!") return;
  if (tag[0] === "#") return emitBlock(t, tag, nodes);
  if (tag[0] === "/") unexpected(t);
  nodes.push(VAL(compileExpr(t[1], t[4])));
};

/**
 * @param {Tok} t
 * @param {string[]} stops
 * @param {Node<any>[]} nodes
 */
let takeToken = (t, stops, nodes) => {
  if (t[0] < 2) return (emitLeaf(t, nodes), 0);
  if (stops.includes(t[1].split(" ")[0])) return ((last = t), 1);
  emitTag(t, t[1], nodes);
  return 0;
};

/**
 * Parse until one of `stops` is reached, or to the end of the token stream.
 *
 * `stops[0]` is the block's closer and the rest are its interior tags, so the
 * unclosed diagnostic below reads the head of the list rather than measuring
 * its way to the tail. Membership is order-blind; keep the closer first.
 *
 * @param {string[]} stops
 * @returns {Node<any>[]}
 */
let parse = (stops) => {
  const nodes = /** @type {Node<any>[]} */ ([]);
  for (let t; (t = tokens[i++]);) {
    if (takeToken(t, stops, nodes)) return nodes;
  }
  // oxlint-disable-next-line no-unused-expressions
  stops.length && fault("Missing {{" + stops[0] + "}}", "SJABLOON_UNCLOSED_BLOCK");
  return nodes;
};

/**
 * Display text for one interpolated value — the scalar rule every edition and
 * the root `text()` join share. A valid `Date` renders as ISO 8601 UTC
 * (`toISOString()`), the same on every machine, where `String(date)` would
 * bake in the host's timezone and locale; an invalid `Date` keeps its
 * deterministic `"Invalid Date"` form. Nullish displays empty; everything
 * else is `String(value)`.
 *
 * @param {unknown} value One rendered value.
 * @returns {string} The display text.
 */
export const display = (value) =>
  value instanceof Date && Number.isFinite(value.getTime())
    ? value.toISOString()
    : // Stringifying an arbitrary value is this rule's documented contract, so
      // `no-base-to-string` is describing the feature rather than a mistake.
      // oxlint-disable-next-line typescript/no-base-to-string
      String(value ?? "");

/**
 * Bind the parser to an output profile. Each edition calls this once at module
 * load and gets back its own `template` and `render`; the parser itself stays
 * module-level and shared, so there is exactly one diagnostics store.
 *
 * `template(str, funcs?, opts?)` compiles a template once, to render it many
 * times.
 *
 * The returned renderer exposes `names`: the variables the template reads
 * from your values, deduplicated. Loop variables the template introduces are
 * not included, and neither is anything in `opts.bound` — names the embedder
 * already has in scope (still resolved normally at render time, exactly like
 * xprsn's own `bound`). It also exposes `reads`: every root-name read with its
 * span in the template source, in source order — duplicates, anchors, loop
 * variables and bound names kept, so `names` is its free, deduplicated view.
 * And `functions`: the registry functions the template calls, deduplicated. `isDiagnostic(error)` recognizes runtime
 * diagnostics thrown through this renderer alone.
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
 * An embedder whose scope chain already binds the anchors renders through
 * `scoped(values)` instead: no wrapper scope is created, `$` and `@` resolve
 * from `values` itself, and a chain that omits `@` leaves it unbound the same
 * way. That is the zero-allocation seam for a host rendering one template per
 * cell per row over scopes it already builds.
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
 *   template: (str: string, funcs?: SjabloonFunctions,
 *     opts?: { bound?: Iterable<string> }) => SjabloonRenderer<T>,
 *   render: (str: string, values?: SjabloonValues, funcs?: SjabloonFunctions) => T,
 * }} That edition's API.
 * @throws {SyntaxError} `template` throws on malformed tags, unclosed blocks,
 *   or bad expressions.
 */
export let make = ([lit, val, raw, seed, take]) => {
  /**
   * @param {string} str
   * @param {SjabloonFunctions} [funcs]
   * @param {{ bound?: Iterable<string> }} [opts]
   * @returns {SjabloonRenderer<T>}
   */
  function template(str, funcs, opts) {
    // oxlint-disable-next-line no-unused-expressions
    ((LIT = lit), (VAL = val), (RAW = raw));
    fns = funcs;
    // `$` (root) and `@` (current item) are engine-bound anchors, always in
    // scope, so they never count as caller-supplied `names` — and neither does
    // anything the embedder declares bound. `Array.from`, not a spread: the
    // bundler's transpile turns an iterable spread into a concat that would
    // wrap a Set instead of unpacking it. `Object(opts)` stands in for the
    // missing-opts check; nothing iterable comes out of an empty string.
    bound = ["$", "@"].concat(
      Array.from(/** @type {Iterable<string>} */ (Object(opts).bound || "")),
    );
    names = new Set();
    reads = [];
    functions = new Set();
    source = String(str);
    blocks = [];
    nest = 0;
    // The lexer's own state, then one linear pass: inline here because it runs
    // exactly once per compile and the parser rewinds `i` straight after.
    tokens = [];
    i = 0;
    lexTriple = 1;
    while (i < source.length && lexStep());
    i = 0;
    // Deeply nested blocks fail as SJABLOON_TOO_DEEP at the cap in opener(),
    // including elif chains — well below the native stack.
    let nodes = parse([]);
    // The trusted-scope render, and the one render body: the caller's chain
    // already carries the anchors, so no wrapper is created and nothing is
    // written anywhere. One accumulator per render, owned here and threaded
    // down. A registry function that renders another template gets its own,
    // so re-entrancy needs no bookkeeping.
    const scoped = (/** @type {any} */ values) => {
      const acc = seed();
      run(nodes, values, acc);
      return take(acc);
    };
    // The default render wraps the values in a root scope carrying the
    // anchors, without mutating what the caller passed: by default `$` and `@`
    // both point at the root. An embedder can override the anchors with a
    // `{ root, item }` second arg: `$` = root, `@` = item (distinct objects).
    // Omitting `item` leaves `@` unbound, so `@.x` throws through xprsn's
    // guard — a group-header band that has no current row wants exactly that.
    const f = (/** @type {any} */ values, /** @type {any} */ anchors) => {
      values = values || EMPTY;
      const r = Object.create(values);
      r["$"] = anchors ? anchors.root : values;
      r["@"] = anchors ? anchors.item : values;
      return scoped(r);
    };
    // Array.from, not a spread: the bundler's transpile turns `[...set]` into
    // `[].concat(set)`, which wraps the Set instead of unpacking it.
    f.names = Array.from(names);
    f.reads = reads;
    f.functions = Array.from(functions);
    // This compile's own `names` set doubles as its origin: every diagnostic
    // thrown through this renderer was marked with it, at compile time by
    // `fault` and at render time by the closures `compileExpr` built. Captured
    // now — the module-level `names` moves on to the next compile.
    const o = names;
    f.isDiagnostic = (/** @type {unknown} */ x) => diags.origin(x) === o;
    f.scoped = scoped;
    return f;
  }
  return { template, render: (str, values, funcs) => template(str, funcs)(values) };
};
