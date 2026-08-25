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
import { compile, isDiagnostic as isXprsnDiagnostic } from "xprsn";

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
export const isDiagnostic = owns;

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
/** @type {Tok[]} */
let tokens;
/** @type {number} */
let i;
/** @type {SjabloonFunctions | undefined} */
let fns;
/** @type {Tok} */
let last;
/** @type {string[]} */
let bound;
/** @type {Set<string>} */
let names;
/** @type {Set<string>} */
let functions;
/** @type {string} */
let source;
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
  if (a < 0) return (tokens.push([0, source.slice(i)]), 0);
  if (a > i) tokens.push([0, source.slice(i, a)]);
  lxRaw = +(source[a + 2] === "{");
  lxP = a + 2 + lxRaw;
  lxL = +(source[lxP] === "-");
  lxP += lxL;
  findEnd(a);
  if (lxB < 0) return (tokens.push([0, source.slice(a)]), 0);
  takeScanned(a);
  return 1;
};

let lex = () => {
  tokens = [];
  i = 0;
  lexTriple = 1;
  while (i < source.length && lexStep());
};

let snap = () => Object.freeze(blocks.slice());
// Block nesting is capped so a pathological template fails as a deterministic
// SyntaxError at the offending opener, far below the native stack limit.
const DEPTH = 256;
/**
 * @param {string} type
 * @param {Tok} t
 */
let opener = (type, t) => {
  // oxlint-disable-next-line no-unused-expressions
  blocks.length < DEPTH || fault("Template too deeply nested", "SJABLOON_TOO_DEEP", t);
  return Object.freeze({ type, start: t[2], end: t[3] });
};
/**
 * @template {object} E
 * @param {E} e
 * @param {any} context
 * @returns {E}
 */
let attach = (e, context) => {
  Object.defineProperty(e, "blocks", { value: context, enumerable: true });
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
const fault = (
  msg,
  code,
  t,
  start = t == null ? source.length : t[2],
  end = t == null ? source.length : t[3],
) => {
  const e = /** @type {SyntaxError & { code: SjabloonErrorCode, start: number, end: number }} */ (
    SyntaxError(msg)
  );
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
 * @param {any} context
 * @returns {(v: any) => any}
 */
let compileExpr = (expr, start, context) => {
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
    translated(x, start, context);
  }
  e.names.forEach((n) => {
    // oxlint-disable-next-line no-unused-expressions
    bound.includes(n) || names.add(n);
  });
  for (const fn of e.functions) functions.add(fn);
  return (v) => {
    try {
      return e(v);
    } catch (x) {
      // Read off the compiled expression to pass along, never called through
      // `e` — xprsn's `isDiagnostic` is a closure over a WeakSet, not a method.
      // oxlint-disable-next-line typescript/unbound-method
      translated(x, start, context, e.isDiagnostic);
    }
  };
};

/**
 * @param {string} stop
 * @param {Node<any>[]} [nodes]
 */
let closeTail = (stop, nodes = parse([stop])) =>
  // oxlint-disable-next-line no-unused-expressions
  (last[1] === stop || unexpected(last), nodes);

// One `#if`/`#elif` link: parse its branch, then recurse on the chain tail.
/**
 * @param {(v: any) => any} cond
 * @returns {Node<any>}
 */
let branch = (cond) => {
  const then = parse(["#elif", "#else", "/if"]);
  const tag = last[1];
  let els = /** @type {Node<any>[]} */ ([]);
  if (tag.startsWith("#elif ")) els = [branch(compileExpr(tag.slice(6), last[4] + 6, snap()))];
  else if (tag === "#else") els = closeTail("/if");
  else if (tag !== "/if") unexpected(last);
  return (scope, acc) => run(cond(scope) ? then : els, scope, acc);
};

/**
 * @param {any} listValue
 */
let eachPairs = (listValue) => {
  if (Array.isArray(listValue)) return listValue.slice();
  if (listValue && typeof listValue === "object")
    return Object.keys(listValue).map((k) => [listValue[k], k]);
  return [];
};

let eachEmpty = () =>
  last[1] === "#else" ? closeTail("/each") : last[1] === "/each" ? [] : unexpected(last);

/**
 * @param {Tok} t
 * @param {string} tag
 * @param {string} name
 * @param {number} at
 */
let checkBinding = (t, tag, name, at) => {
  // oxlint-disable-next-line no-unused-expressions
  BLOCKED.test(name) &&
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
  const list = compileExpr(m[1], t[4] + 6, snap());
  const mark = bound.length;
  bound.push(name);
  if (idx) {
    checkBinding(t, tag, idx, t[4] + tag.length - idx.length);
    bound.push(idx);
  }
  bound.push("loop");
  const body = parse(["#else", "/each"]);
  bound.length = mark;
  const empty = eachEmpty();
  blocks.pop();
  nodes.push((scope, acc) => {
    const listValue = list(scope),
      arr = Array.isArray(listValue);
    const pairs = eachPairs(listValue);
    if (!pairs.length) return run(empty, scope, acc);
    pairs.forEach((x, j) => {
      const item = arr ? x : x[0],
        key = arr ? j : x[1];
      const child = Object.create(scope);
      child[name] = item;
      if (idx) child[idx] = key;
      child["@"] = item;
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
  nodes.push(RAW(compileExpr(t[1], t[4], snap())));
};

/**
 * @param {Tok} t
 * @param {string} tag
 * @param {Node<any>[]} nodes
 */
let emitBlock = (t, tag, nodes) => {
  if (tag.startsWith("#if ")) {
    blocks.push(opener("if", t));
    nodes.push(branch(compileExpr(tag.slice(4), t[4] + 4, snap())));
    blocks.pop();
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
  nodes.push(VAL(compileExpr(t[1], t[4], snap())));
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
 * @param {string[]} stops
 * @returns {Node<any>[]}
 */
let parse = (stops) => {
  const nodes = /** @type {Node<any>[]} */ ([]);
  for (let t; (t = tokens[i++]);) {
    if (takeToken(t, stops, nodes)) return nodes;
  }
  // oxlint-disable-next-line no-unused-expressions
  stops.length && fault("Missing {{" + stops[stops.length - 1] + "}}", "SJABLOON_UNCLOSED_BLOCK");
  return nodes;
};

/**
 * Literal text node for the string editions: append `text` onto `acc.text`.
 *
 * @param {string} text
 * @returns {Node<{ text: string }>}
 */
export const litNode = (text) => (scope, acc) => {
  acc.text += text;
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
    // oxlint-disable-next-line no-unused-expressions
    ((LIT = lit), (VAL = val), (RAW = raw));
    fns = funcs;
    // `$` (root) and `@` (current item) are engine-bound anchors, always in
    // scope, so they never count as caller-supplied `names`.
    bound = ["$", "@"];
    names = new Set();
    functions = new Set();
    source = String(str);
    blocks = [];
    lex();
    i = 0;
    // Deeply nested blocks overflow the recursive-descent parser; surface that
    // as a SyntaxError so malformed input keeps its documented compile-time
    // contract (mirroring xprsn's XPRSN_TOO_DEEP for expressions).
    let nodes;
    try {
      nodes = parse([]);
    } catch (x) {
      // An empty span at the end, like an unclosed block.
      if (x instanceof RangeError) fault("Template too deeply nested", "SJABLOON_TOO_DEEP");
      throw x;
    }
    // Wrap the values in a root scope carrying the anchors, without mutating
    // what the caller passed: by default `$` and `@` both point at the root.
    // An embedder can override the anchors with a `{ root, item }` second arg:
    // `$` = root, `@` = item (distinct objects). Omitting `item` leaves `@`
    // unbound, so `@.x` throws through xprsn's guard — a group-header band that
    // has no current row wants exactly that.
    const f = (/** @type {any} */ values, /** @type {any} */ anchors) => {
      values = values || EMPTY;
      const r = Object.create(values);
      r["$"] = anchors ? anchors.root : values;
      r["@"] = anchors ? anchors.item : values;
      // One accumulator per render, owned here and threaded down. A registry
      // function that renders another template gets its own, so re-entrancy
      // needs no bookkeeping.
      const acc = seed();
      run(nodes, r, acc);
      return take(acc);
    };
    // Array.from, not a spread: the bundler's transpile turns `[...set]` into
    // `[].concat(set)`, which wraps the Set instead of unpacking it.
    f.names = Array.from(names);
    f.functions = Array.from(functions);
    return f;
  }
  return { template, render: (str, values, funcs) => template(str, funcs)(values) };
};
