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
