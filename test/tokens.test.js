// The token stream: the shape the engine emits, and text() that collapses it.
// Shared template semantics are in render.test.js; where the editions differ is
// in editions.test.js.
import assert from "node:assert/strict";
import test from "node:test";
import { display, template, text } from "../lib/index.js";
import { template as plain } from "../lib/text.js";

const lit = (literal) => ({ literal });
const val = (value) => ({ value });

// The whole reason the engine emits tokens rather than { text, raws }: a
// consumer has to be able to tell a bare value from a value in a sentence.
test("literals and values interleave in render order", () => {
  assert.deepStrictEqual(template("a{{ x }}b")({ x: 1 }), [lit("a"), val(1), lit("b")]);
  assert.deepStrictEqual(template("plain text")(), [lit("plain text")]);
  assert.deepStrictEqual(template("")(), []);
  assert.deepStrictEqual(
    template("{{ amount }}")({ amount: 1000 }),
    [val(1000)],
    "a bare interpolation is one value token",
  );
  assert.deepStrictEqual(
    template("Total: {{ amount }}")({ amount: 1000 }),
    [lit("Total: "), val(1000)],
    "distinguishable from this",
  );
  assert.deepStrictEqual(
    template("{{ a }}{{ b }}")({ a: 1, b: 2 }),
    [val(1), val(2)],
    "no empty literal between adjacent tags",
  );
  assert.deepStrictEqual(
    template("  {{- a }}")({ a: 1 }),
    [val(1)],
    "nor for a text run trimmed to nothing",
  );
});

test("values are captured pre-stringify", () => {
  const tokens = template("{{ n }}{{ d }}{{ o }}")({ n: 1000, d: null, o: { a: 1 } });
  assert.strictEqual(tokens[0].value, 1000, "numbers stay numbers");
  assert.strictEqual(
    tokens[1].value,
    null,
    "nullish is captured as-is, not the empty string it renders as",
  );
  assert.deepStrictEqual(tokens[2].value, { a: 1 }, "objects pass through untouched");
  assert.deepStrictEqual(
    template("{{ fmt(total) }}", { fmt: (n) => "$" + n.toFixed(2) })({ total: 1000 }),
    [val("$1000.00")],
    "a registry call captures its result, not its input",
  );
});

test("blocks: per iteration, taken branches only, never block expressions", () => {
  assert.deepStrictEqual(
    template("{{#each items as it}}{{ it * 2 }}{{/each}}")({ items: [1, 2, 3] }),
    [val(2), val(4), val(6)],
    "loop bodies append once per iteration; the collection is not captured",
  );
  assert.deepStrictEqual(
    template("{{#if ok}}{{ a }}{{#else}}{{ b }}{{/if}}")({ ok: true, a: "A", b: "B" }),
    [val("A")],
    "untaken branches append nothing; the condition is not captured",
  );
  assert.deepStrictEqual(
    template("{{#each items as it}}{{ it }}{{#else}}{{ fallback }}{{/each}}")({
      items: [],
      fallback: "none",
    }),
    [val("none")],
    "the else branch appends when it renders",
  );
  assert.deepStrictEqual(
    template("{{#each xs as x}}[{{ x }}]{{/each}}")({ xs: ["a", "b"] }),
    [lit("["), val("a"), lit("]"), lit("["), val("b"), lit("]")],
    "literals repeat per iteration, interleaved in place",
  );
});

test("every render owns its stream, including under re-entrancy", () => {
  const tpl = template("{{ a }}");
  const first = tpl({ a: 1 });
  tpl({ a: 2 });
  assert.deepStrictEqual(first, [val(1)], "an intervening render does not touch an earlier result");

  const inner = template("{{ x }}");
  const seen = [];
  const funcs = {
    nested: (v) => {
      const t = inner({ x: v * 10 });
      seen.push(t);
      return text(t);
    },
    throwing: () => {
      try {
        inner();
      } catch {
        /* ignore */
      }
      return "ok";
    },
  };
  assert.deepStrictEqual(
    template("{{ nested(a) }}{{ throwing() }}{{ a }}", funcs)({ a: 7 }),
    [val("70"), val("ok"), val(7)],
    "inner renders never pollute the outer stream",
  );
  assert.deepStrictEqual(seen, [[val(70)]], "and only see their own tokens");
});

test("literal tokens are frozen and shared across iterations", () => {
  const tokens = template("{{#each xs as x}}-{{ x }}{{/each}}")({ xs: [1, 2] });
  assert.strictEqual(Object.isFrozen(tokens[0]), true, "literals are compile-time constants");
  assert.strictEqual(
    tokens[0],
    tokens[2],
    "one hoisted object per text node, not one per iteration",
  );
  assert.notStrictEqual(tokens[1], tokens[3], "value tokens are fresh per emit");
});

test("text() joins literals verbatim and values through display()", () => {
  assert.strictEqual(text(template("a{{ x }}b")({ x: 1 })), "a1b");
  assert.strictEqual(text(template("{{ x }}")({ x: null })), "", "nullish joins as empty");
  assert.strictEqual(text(template("{{ x }}")({})), "", "missing joins as empty");
  assert.strictEqual(text([]), "");
});

test("a Date displays as ISO 8601 UTC, the same on every machine", () => {
  const d = new Date("2026-01-02T00:30:00Z");
  assert.strictEqual(display(d), "2026-01-02T00:30:00.000Z");
  assert.strictEqual(
    text(template("at {{ d }}")({ d })),
    "at 2026-01-02T00:30:00.000Z",
    "text() joins Dates through the same rule",
  );
  assert.strictEqual(
    display(new Date(NaN)),
    "Invalid Date",
    "an invalid Date keeps its deterministic String form",
  );
  assert.strictEqual(display(null), "", "nullish displays empty");
  assert.strictEqual(display(undefined), "");
  assert.strictEqual(display(0), "0", "present falsy values still display");
});

// Found by the fuzzer: the token edition renders values the string editions
// cannot convert, because it never stringifies. The failure is deferred to
// text(), not avoided — so the equivalence property still holds.
test("stringification is deferred, so text() fails where the stream did not", () => {
  const hostile = Object.create(null);
  const tokens = template("{{ x }}")({ x: hostile });
  assert.deepStrictEqual(tokens, [val(hostile)], "the stream carries the value untouched");
  assert.throws(() => text(tokens), TypeError, "the join is where conversion happens, and fails");
  assert.throws(
    () => plain("{{ x }}")({ x: hostile }),
    TypeError,
    "the string edition fails at render",
  );
});

// The compile-time tag. An embedder that has to treat one interpolation
// differently from the rest — a page number a word processor writes as a live
// field, say — cannot tell them apart from the stream: a value token carries
// its value and nothing about where it came from. `tag` is the seam. It is
// read once per interpolation while parsing, so the emitted token carries a
// compile-time constant and a template no embedder tagged keeps the exact
// stream it always had.
test("tag names an interpolation by its expression source", () => {
  const tag = (expr) => (expr === "page.number" ? { field: "page.number" } : undefined);
  const opts = { tag };
  assert.deepStrictEqual(
    template(
      "Page {{ page.number }} of {{ page.total }}",
      undefined,
      opts,
    )({
      page: { number: 1, total: 2 },
    }),
    [lit("Page "), { value: 1, field: "page.number" }, lit(" of "), val(2)],
    "the returned keys join the value token; an undefined leaves it untouched",
  );
  assert.deepStrictEqual(
    template("{{- page.number -}}", undefined, opts)({ page: { number: 3 } }),
    [{ value: 3, field: "page.number" }],
    "the source is the expression as trimmed, so whitespace and dashes do not hide it",
  );
  assert.deepStrictEqual(
    template("{{ page.number }}")({ page: { number: 1 } }),
    [val(1)],
    "no tag, no key",
  );
  assert.deepStrictEqual(
    template("{{ x }}", undefined, { tag: () => ({ value: "taken over" }) })({ x: 1 }),
    [val(1)],
    "`value` is the token's own; a tag cannot take it over",
  );
});

test("tag sees interpolations only, once each, at compile time", () => {
  const seen = [];
  const tpl = template("{{#if on}}{{#each xs as x}}{{ x }}{{/each}}{{/if}}", undefined, {
    tag: (expr) => void seen.push(expr),
  });
  assert.deepStrictEqual(seen, ["x"], "block expressions steer the render and emit no token");
  tpl({ on: true, xs: [1, 2] });
  tpl({ on: true, xs: [1, 2] });
  assert.deepStrictEqual(seen, ["x"], "and a render never asks again");
});

test("a tagged interpolation carries its keys on every emit", () => {
  const tokens = template("{{#each xs as x}}{{ x }}{{/each}}", undefined, {
    tag: () => ({ field: "x" }),
  })({ xs: [1, 2] });
  assert.deepStrictEqual(tokens, [
    { value: 1, field: "x" },
    { value: 2, field: "x" },
  ]);
  assert.notStrictEqual(tokens[0], tokens[1], "value tokens stay fresh per emit");
});

// An embedder that resolves a value out of band -- a host function reaching a
// network -- needs two things: the call on its own, so it can run it against a
// scope of its choosing, and a way to hand the answer back for the render.
const counted = () => {
  const seen = [];
  return { seen, look: (x) => (seen.push(x), "got:" + x) };
};

test("slots expose the interpolations a registry function answers", () => {
  const { look } = counted();
  const f = template("{{ look(a) }} and {{ b }} and {{ look(c) }}", { look });
  assert.strictEqual(f.slots.length, 2, "one slot per call-bearing interpolation");
  assert.strictEqual(f.slots[0]({ a: 1 }), "got:1", "a slot evaluates its own expression");
  assert.strictEqual(f.slots[1]({ c: 2 }), "got:2", "slots are in source order");
  assert.deepStrictEqual(template("{{ a }}{{ b }}", { look }).slots, [], "no calls, no slots");
});

test("a block's own expression is not a slot", () => {
  const { look } = counted();
  assert.deepStrictEqual(
    template("{{#if look(a)}}{{ b }}{{/if}}", { look }).slots,
    [],
    "an #if condition renders no token, so it holds no slot",
  );
  assert.deepStrictEqual(
    template("{{#each look(a) as r}}{{ r }}{{/each}}", { look }).slots,
    [],
    "nor does an #each list",
  );
});

test("a supplied value replaces the call, and the call is not made", () => {
  const { seen, look } = counted();
  const f = template("x{{ look(a) }}y{{ look(c) }}", { look });
  assert.deepStrictEqual(
    f.scoped({ a: 1, c: 2 }, ["one", "two"]),
    [lit("x"), val("one"), lit("y"), val("two")],
    "each slot takes its supplied value",
  );
  assert.deepStrictEqual(seen, [], "nothing was called");
  assert.deepStrictEqual(
    f.scoped({ a: 1, c: 2 }),
    [lit("x"), val("got:1"), lit("y"), val("got:2")],
    "a render with no supply evaluates as before",
  );
  assert.deepStrictEqual(seen, [1, 2], "and calls once each");
});

test("a supply does not leak into the next render", () => {
  const { look } = counted();
  const f = template("{{ look(a) }}", { look });
  assert.deepStrictEqual(f.scoped({ a: 1 }, ["held"]), [val("held")]);
  assert.deepStrictEqual(f({ a: 9 }), [val("got:9")], "the default render is unaffected");
  const g = template("{{ look(a) }}", { look });
  assert.deepStrictEqual(g.scoped({ a: 4 }), [val("got:4")], "another template is unaffected");
});

test("an unsupplied slot falls back to its own call", () => {
  const { look } = counted();
  const f = template("{{ look(a) }}{{ look(b) }}", { look });
  // Built rather than written as a literal: the hole at 0 is the subject.
  const holed = [];
  holed[1] = "given";
  assert.deepStrictEqual(
    f.scoped({ a: 1, b: 2 }, holed),
    [val("got:1"), val("given")],
    "a hole in the supply evaluates normally",
  );
  assert.deepStrictEqual(
    f.scoped({ a: 1, b: 2 }, [undefined, "given"]),
    [val(undefined), val("given")],
    "a supplied undefined is a value, not a hole",
  );
});

test("a slot names the registry functions it calls", () => {
  const { look } = counted();
  const f = template("{{ look(a) }}{{ look(b) + 1 }}", { look, twice: (x) => x * 2 });
  assert.deepStrictEqual(f.slots[0].functions, ["look"], "one call, one name");
  assert.deepStrictEqual(
    template("{{ twice(look(a)) }}", { look, twice: (x) => x }).slots[0].functions,
    ["twice", "look"],
    "every name the expression calls, in call order",
  );
});
