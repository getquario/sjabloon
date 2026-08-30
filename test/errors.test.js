import assert from "node:assert/strict";
import test from "node:test";
import { compile, isDiagnostic as isXprsnDiagnostic } from "xprsn";
import { isDiagnostic, relocate, template } from "../lib/html.js";

let caught = (fn) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  assert.fail("expected an error");
};

let check = (e, code, start, end, blocks = []) => {
  assert.ok(e instanceof SyntaxError || e instanceof TypeError);
  assert.equal(e.code, code);
  assert.equal(e.start, start);
  assert.equal(e.end, end);
  assert.equal(isDiagnostic(e), true);
  assert.deepStrictEqual(e.blocks, blocks);
  assert.equal(Object.isFrozen(e.blocks), true);
  for (const block of e.blocks) assert.equal(Object.isFrozen(block), true);
  return true;
};

test("xprsn compile diagnostics use absolute interpolation spans", () => {
  let src = "before {{- 1 + -}} after";
  let e = caught(() => template(src));
  check(e, "XPRSN_SYNTAX", src.indexOf("+") + 1, src.indexOf("+") + 1);

  src = "before {{{ 1 + }}} after";
  e = caught(() => template(src));
  check(e, "XPRSN_SYNTAX", src.indexOf("+") + 1, src.indexOf("+") + 1);
});

test("block expressions retain absolute spans and opener context", () => {
  let src = "{{#if 1 +}}x{{/if}}";
  let e = caught(() => template(src));
  check(e, "XPRSN_SYNTAX", src.indexOf("}}"), src.indexOf("}}"), [
    { type: "if", start: 0, end: 11 },
  ]);

  src = "{{#if false}}x{{#elif nope()}}y{{/if}}";
  e = caught(() => template(src));
  check(e, "XPRSN_UNKNOWN_FUNCTION", src.indexOf("nope"), src.indexOf("nope") + 4, [
    { type: "if", start: 0, end: 13 },
  ]);

  src = "{{#each 1 + as x}}x{{/each}}";
  e = caught(() => template(src));
  check(e, "XPRSN_SYNTAX", src.indexOf(" as"), src.indexOf(" as"), [
    { type: "each", start: 0, end: 18 },
  ]);
});

test("runtime xprsn diagnostics retain nested block context", () => {
  const src = "{{#if ok}}{{#each rows as r}}{{ r.missing.value }}{{/each}}{{/if}}";
  const e = caught(() => template(src)({ ok: true, rows: [{}] }));
  const start = src.indexOf("value");
  check(e, "XPRSN_NULL_BASE", start, start + 5, [
    { type: "if", start: 0, end: 10 },
    { type: "each", start: 10, end: 29 },
  ]);
});

test("repeated tags use their own retained offsets", () => {
  const src = "{{ next().value }}|{{ next().value }}";
  let n = 0;
  const f = template(src, { next: () => (++n === 1 ? { value: "ok" } : null) });
  const e = caught(() => f());
  const start = src.lastIndexOf("value");
  check(e, "XPRSN_NULL_BASE", start, start + 5);
});

test("native parser errors expose stable codes and spans", () => {
  let src = "{{#each items}}x{{/each}}";
  check(
    caught(() => template(src)),
    "SJABLOON_EACH_SYNTAX",
    0,
    15,
    [{ type: "each", start: 0, end: 15 }],
  );

  src = "{{#each xs as constructor}}x{{/each}}";
  check(
    caught(() => template(src)),
    "SJABLOON_BLOCKED_BINDING",
    14,
    25,
    [{ type: "each", start: 0, end: 27 }],
  );

  src = "{{/if}}";
  check(
    caught(() => template(src)),
    "SJABLOON_UNEXPECTED_TAG",
    0,
    src.length,
  );

  src = "{{#unknown}}x{{/unknown}}";
  check(
    caught(() => template(src)),
    "SJABLOON_UNKNOWN_BLOCK",
    0,
    12,
  );

  src = "{{#if ok}}yes";
  check(
    caught(() => template(src)),
    "SJABLOON_UNCLOSED_BLOCK",
    src.length,
    src.length,
    [{ type: "if", start: 0, end: 10 }],
  );
});

test("malformed branch controls fail inside their block", () => {
  for (const tag of ["#elif", "#else nope", "/if nope"]) {
    const src = "{{#if ok}}x{{" + tag + "}}y{{/if}}";
    const start = src.indexOf("{{", 2);
    check(
      caught(() => template(src)),
      "SJABLOON_UNEXPECTED_TAG",
      start,
      start + tag.length + 4,
      [{ type: "if", start: 0, end: 10 }],
    );
  }
});

test("closers must match the stop tag exactly", () => {
  assert.throws(
    () => template("{{#if a}}x{{#else}}y{{/if extra}}"),
    /Unexpected \{\{\/if extra\}\}/,
  );
  assert.throws(
    () => template("{{#each xs as x}}x{{#else}}y{{/each extra}}"),
    /Unexpected \{\{\/each extra\}\}/,
  );
  assert.throws(
    () => template("{{#each xs as x}}x{{/each extra}}"),
    /Unexpected \{\{\/each extra\}\}/,
    "each body stop tags compare exact",
  );
  assert.throws(
    () => template("{{#each xs as x}}x{{#else nope}}y{{/each}}"),
    /Unexpected \{\{#else nope\}\}/,
  );
});

test("each rejects foreign closers and elif", () => {
  assert.throws(() => template("{{#each xs as x}}x{{/if}}"), /Unexpected \{\{\/if\}\}/);
  assert.throws(() => template("{{#each xs as x}}x{{#elif a}}y{{/each}}"), /Unexpected \{\{#elif/);
});

test("bare if/elif/else openers are unexpected", () => {
  assert.throws(() => template("{{#if}}x{{/if}}"), /Unexpected \{\{#if\}\}/);
  assert.throws(() => template("{{#elif a}}x{{/elif}}"), /Unexpected \{\{#elif/);
  assert.throws(() => template("{{#else}}x{{/else}}"), /Unexpected \{\{#else\}\}/);
});

test("each else stays in block context and outside binding scope", () => {
  const src = "{{#each rows as r}}x{{#else}}{{ missing.value }}{{/each}}";
  const f = template(src);
  assert.ok(f.names.includes("missing"));
  const e = caught(() => f({ rows: [] }));
  const start = src.indexOf("value");
  check(e, "XPRSN_NULL_BASE", start, start + 5, [{ type: "each", start: 0, end: 19 }]);
});

test("missing nested closers report EOF with all unmatched openers", () => {
  const src = "{{#if ok}}{{#each rows as r}}x";
  check(
    caught(() => template(src)),
    "SJABLOON_UNCLOSED_BLOCK",
    src.length,
    src.length,
    [
      { type: "if", start: 0, end: 10 },
      { type: "each", start: 10, end: 29 },
    ],
  );
});

test("host errors and exact metadata spoofs pass through unchanged", () => {
  const host = TypeError("host failed");
  host.code = "XPRSN_NULL_BASE";
  host.start = 0;
  host.end = 4;
  host.blocks = Object.freeze([]);
  const e = caught(() =>
    template("{{ boom() }}", {
      boom: () => {
        throw host;
      },
    })(),
  );
  assert.equal(e, host);
  assert.equal(isDiagnostic(e), false);
  assert.equal(e.start, 0);

  const getter = Error("getter failed");
  const values = {
    get value() {
      throw getter;
    },
  };
  assert.equal(
    caught(() => template("{{ value }}")(values)),
    getter,
  );
  assert.equal(isDiagnostic(getter), false);
});

test("authentic xprsn errors from host boundaries pass through unchanged", () => {
  const compileError = caught(() => compile("1 +"));
  const foreign = compile("a.b");
  const runtimeError = caught(() => foreign({ a: null }));
  const cases = [
    [
      template("{{ boom() }}", {
        boom: () => {
          throw compileError;
        },
      }),
      {},
    ],
    [template("{{ boom() }}", { boom: () => foreign({ a: null }) }), {}],
    [
      template("{{ a.b }}"),
      {
        a: {
          get b() {
            throw runtimeError;
          },
        },
      },
    ],
    [
      template("{{ a.m() }}"),
      {
        a: {
          m() {
            throw runtimeError;
          },
        },
      },
    ],
    [
      template('{{ a ~ "" }}'),
      {
        a: {
          [Symbol.toPrimitive]() {
            throw runtimeError;
          },
        },
      },
    ],
  ];

  for (const [render, values] of cases) {
    const e = caught(() => render(values));
    assert.ok(e === compileError || foreign.isDiagnostic(e));
    assert.equal(isDiagnostic(e), false);
    assert.equal(Object.hasOwn(e, "blocks"), false);
  }
  assert.deepStrictEqual([compileError.start, compileError.end], [3, 3]);
  assert.deepStrictEqual([runtimeError.start, runtimeError.end], [2, 3]);
});

test("unauthenticated expression errors pass through without template context", () => {
  const e = caught(() => template("{{ 1 in null }}")());
  assert.ok(e instanceof TypeError);
  assert.equal(isDiagnostic(e), false);
  assert.equal(Object.hasOwn(e, "blocks"), false);
});

test("diagnostic context is immutable and independent", () => {
  const one = caught(() => template("{{#if ok}}{{ missing.value }}{{/if}}")({ ok: true }));
  const two = caught(() => template("{{#if ok}}{{ missing.value }}{{/if}}")({ ok: true }));
  assert.notEqual(one.blocks, two.blocks);
  assert.notEqual(one.blocks[0], two.blocks[0]);
  assert.throws(() => {
    one.blocks = [];
  }, TypeError);
  assert.throws(() => one.blocks.push({}), TypeError);
  assert.throws(() => {
    one.blocks[0].start = 2;
  }, TypeError);
});

test("compiled renderer remains reusable after a runtime diagnostic", () => {
  const f = template("{{ item.value }}");
  const e = caught(() => f({ item: null }));
  assert.equal(isDiagnostic(e), true);
  assert.equal(f({ item: { value: "ok" } }), "ok");
});

test("provenance survives later WeakMap prototype replacement", () => {
  // Captured to restore in `finally`, never called — `unbound-method` reads the
  // saving of a prototype method as the scoping hazard of calling one.
  // oxlint-disable-next-line typescript/unbound-method
  const set = WeakMap.prototype.set;
  // oxlint-disable-next-line typescript/unbound-method
  const has = WeakMap.prototype.has;
  try {
    WeakMap.prototype.set = () => {
      throw Error("replaced set");
    };
    WeakMap.prototype.has = () => true;
    const e = caught(() => template("{{ 1 + }}"));
    assert.equal(isDiagnostic(e), true);
    assert.equal(isDiagnostic(Error("spoof")), false);
  } finally {
    WeakMap.prototype.set = set;
    WeakMap.prototype.has = has;
  }
});

test("bad expressions retain their existing messages and types", () => {
  assert.throws(() => template("{{ 1 + }}"), SyntaxError);
  assert.throws(() => template("{{ nope(1) }}"), /nope is not a function/);
  assert.throws(() => template("{{#if 1 + }}x{{/if}}"), SyntaxError);
});

test("deeply nested blocks surface as a typed SyntaxError, not a stack overflow", () => {
  const n = 20000;
  const deep = "{{#if a}}".repeat(n) + "x" + "{{/if}}".repeat(n);
  const e = caught(() => template(deep));
  assert.ok(e instanceof SyntaxError, "a SyntaxError, not a RangeError");
  assert.strictEqual(e.code, "SJABLOON_TOO_DEEP");
  assert.strictEqual(e.start, 256 * 9, "located at the opener that crossed the cap");
  assert.strictEqual(e.end, 256 * 9 + 9);
  assert.strictEqual(e.blocks.length, 256, "context carries the open chain");
  assert.ok(isDiagnostic(e), "authenticated as a sjabloon diagnostic");
});

test("runaway elif chains stay a typed SyntaxError through the depth budget", () => {
  const n = 300;
  const deep = "{{#if a}}" + "{{#elif a}}".repeat(n) + "{{/if}}";
  const e = caught(() => template(deep));
  assert.ok(e instanceof SyntaxError, "a SyntaxError, not a RangeError");
  assert.strictEqual(e.code, "SJABLOON_TOO_DEEP");
  assert.strictEqual(e.blocks.length, 1, "elif links do not pollute block context");
  assert.ok(isDiagnostic(e), "authenticated as a sjabloon diagnostic");
});

test("a renderer recognizes its own runtime diagnostics alone", () => {
  const mine = template("{{ item.value }}");
  const other = template("{{ item.value }}");
  const e = caught(() => mine({ item: null }));
  assert.equal(mine.isDiagnostic(e), true, "the thrower owns it");
  assert.equal(other.isDiagnostic(e), false, "an identical template does not");
  assert.equal(isDiagnostic(e), true, "the module-wide check still holds");
  assert.equal(mine.isDiagnostic(SyntaxError("spoof")), false);
  assert.equal(mine.isDiagnostic(null), false);
});

test("a host error thrown by a registry function stays foreign", () => {
  const boom = new Error("host");
  const f = template("{{ f() }}", {
    f: () => {
      throw boom;
    },
  });
  const e = caught(() => f());
  assert.equal(e, boom, "rethrown untouched");
  assert.equal(f.isDiagnostic(e), false);
  assert.equal(isDiagnostic(e), false);
});

test("scoped renders throw the same located diagnostics", () => {
  const src = "{{ item.value }}";
  const f = template(src);
  const e = caught(() => f.scoped(Object.assign(Object.create(null), { item: null })));
  check(e, "XPRSN_NULL_BASE", src.indexOf("value"), src.indexOf("value") + 5);
  assert.equal(f.isDiagnostic(e), true, "owned by the renderer that threw it");
});

test("relocate keeps the owning renderer's recognition", () => {
  const f = template("{{ item.value }}");
  const other = template("{{ item.value }}");
  const moved = relocate(
    caught(() => f({ item: null })),
    { prefix: "cell: ", offset: 2 },
  );
  assert.equal(f.isDiagnostic(moved), true, "the copy answers to the thrower");
  assert.equal(other.isDiagnostic(moved), false, "and to nobody else");
  assert.equal(isXprsnDiagnostic(moved), true, "xprsn provenance survives too");
});

test("relocate returns an authenticated copy in the embedder's coordinates", () => {
  const src = "{{#if 1 +}}x{{/if}}";
  const original = caught(() => template(src));

  const moved = relocate(original, { prefix: "cell.value: ", offset: 3 });

  check(moved, original.code, original.start + 3, original.end + 3, original.blocks);
  assert.equal(moved.message, "cell.value: " + original.message);
  assert.notEqual(moved, original);
  assert.equal(original.start, src.indexOf("}}"), "the original is left untouched");
});

test("relocate carries the block context across, still immutable", () => {
  const original = caught(() => template("{{#if 1 +}}x{{/if}}"));
  const moved = relocate(original, { offset: 1 });

  assert.deepStrictEqual(moved.blocks, original.blocks);
  assert.equal(moved.blocks, original.blocks, "the same frozen context, not a copy");
  assert.throws(() => {
    moved.blocks = [];
  }, TypeError);
});

test("relocate defaults to no prefix and no shift", () => {
  const original = caught(() => template("{{ 1 + }}"));
  const moved = relocate(original);

  check(moved, original.code, original.start, original.end, original.blocks);
  assert.equal(moved.message, original.message);
});

test("relocate keeps the constructor of a runtime diagnostic", () => {
  const original = caught(() => template("{{ item.value }}")({ item: null }));
  const moved = relocate(original, { prefix: "detail: ", offset: 2 });

  assert.ok(moved instanceof TypeError);
  check(moved, original.code, original.start + 2, original.end + 2, original.blocks);
});

test("relocate refuses anything that is not a sjabloon diagnostic", () => {
  const spoof = Object.assign(SyntaxError("spoof"), {
    code: "SJABLOON_UNEXPECTED_TAG",
    start: 0,
    end: 1,
  });
  for (const value of [
    null,
    undefined,
    1,
    "SJABLOON_UNEXPECTED_TAG",
    {},
    SyntaxError("host"),
    spoof,
  ])
    assert.throws(() => relocate(value), TypeError);
});

test("relocate does not mint a diagnostic through a replaced constructor", () => {
  const d = caught(() => template("{{ 1 + }}"));
  const real = SyntaxError.prototype.constructor;
  try {
    SyntaxError.prototype.constructor = function () {
      return { pwned: true };
    };
    const moved = relocate(d, { prefix: "x: " });
    assert.ok(moved instanceof SyntaxError, "the class comes from a captured table");
    assert.ok(!Object.hasOwn(moved, "pwned"));
    assert.equal(isDiagnostic(moved), true);
  } finally {
    SyntaxError.prototype.constructor = real;
  }
});

test("relocate keeps a translated diagnostic authentic to xprsn as well", () => {
  // An expression fault is registered in both stores, so its copy must be too:
  // an embedder that asks xprsn about a relocated error gets the same answer it
  // got about the original.
  const original = caught(() => template("{{ 1 + }}"));
  assert.equal(isXprsnDiagnostic(original), true, "the premise");

  const moved = relocate(original, { prefix: "cell: ", offset: 2 });
  assert.equal(isXprsnDiagnostic(moved), true);
  assert.equal(isDiagnostic(moved), true);
  assert.equal(moved.start, original.start + 2);

  // A fault sjabloon raised itself belongs to sjabloon alone, before and after.
  const native = caught(() => template("{{#each rows as row}}"));
  assert.equal(isXprsnDiagnostic(native), false, "the premise");
  const movedNative = relocate(native, { offset: 2 });
  assert.equal(isXprsnDiagnostic(movedNative), false);
  assert.equal(isDiagnostic(movedNative), true);
});

test("relocate degrades to a plain Error when the original's prototype was replaced", () => {
  // A native sjabloon fault, so the copy's class comes from the captured
  // table rather than from the xprsn branch.
  const d = caught(() => template("{{#each rows as row}}"));
  Object.setPrototypeOf(d, Object.create(null));

  const moved = relocate(d, { prefix: "x: " });
  assert.ok(moved instanceof Error, "an unrecognized class falls back to Error");
  assert.ok(!(moved instanceof SyntaxError));
  assert.equal(isDiagnostic(moved), true, "and is still authenticated");
});

test("relocate names this package when it refuses, not its dependency", () => {
  // The message is documented here, and the guard has to stay here to keep it:
  // waarmerk refuses in its own name, which is a package the caller never chose.
  assert.throws(
    () => relocate(SyntaxError("from somewhere else")),
    (e) => e instanceof TypeError && e.message === "Not a diagnostic from sjabloon",
  );
});
