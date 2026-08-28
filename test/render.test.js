// Template semantics: the lexer, parser, blocks, scopes and metadata that all
// three editions share, because they share one core. Run once, through
// sjabloon/text — the plainest edition — so assertions read as the template's
// meaning rather than one edition's output. Where the editions actually differ
// is small, and lives in editions.test.js and tokens.test.js.
import assert from "node:assert/strict";
import test from "node:test";
import { render, template } from "../lib/text.js";

const notOk = (value, message) => assert.ok(!value, message);

test("interpolation", () => {
  assert.strictEqual(render("Hello {{ name }}!", { name: "Robin" }), "Hello Robin!");
  assert.strictEqual(render("{{ a + b }}", { a: 1, b: 2 }), "3");
  assert.strictEqual(render("{{ user.name.toUpperCase() }}", { user: { name: "robin" } }), "ROBIN");
  assert.strictEqual(render('{{ "static" }}'), "static");
  assert.strictEqual(render("no tags at all"), "no tags at all");
  assert.strictEqual(render(""), "");
  assert.strictEqual(render("[{{ missing }}]", {}), "[]", "undefined renders empty");
  assert.strictEqual(render("[{{ a }}]", { a: null }), "[]", "null renders empty");
});

test("if, elif, else", () => {
  assert.strictEqual(render("{{#if ok}}yes{{/if}}", { ok: true }), "yes");
  assert.strictEqual(render("{{#if ok}}yes{{/if}}", { ok: false }), "");
  assert.strictEqual(render("{{#if ok}}yes{{#else}}no{{/if}}", { ok: false }), "no");
  assert.strictEqual(render("{{#if n > 3 and n < 10}}mid{{/if}}", { n: 5 }), "mid");
  assert.strictEqual(
    render("{{#if a}}{{#if b}}both{{/if}}{{#else}}not a{{/if}}", { a: true, b: true }),
    "both",
    "nested",
  );

  const chain = "{{#if n > 10}}big{{#elif n > 5}}mid{{#elif n > 0}}small{{#else}}none{{/if}}";
  assert.strictEqual(render(chain, { n: 20 }), "big");
  assert.strictEqual(render(chain, { n: 7 }), "mid");
  assert.strictEqual(render(chain, { n: 2 }), "small");
  assert.strictEqual(render(chain, { n: 0 }), "none");
  assert.strictEqual(
    render("{{#if a}}x{{#elif b}}y{{/if}}", { b: true }),
    "y",
    "elif without else",
  );
  assert.strictEqual(render("{{#if a}}x{{#elif b}}y{{/if}}", {}), "", "no branch matches");
  assert.strictEqual(
    render("{{#if a}}{{#if b}}1{{#elif c}}2{{/if}}{{#elif d}}3{{/if}}", { a: true, c: true }),
    "2",
    "nested chains",
  );
});

test("each over arrays and objects", () => {
  assert.strictEqual(
    render("{{#each items as it}}[{{ it }}]{{/each}}", { items: [1, 2] }),
    "[1][2]",
  );
  assert.strictEqual(
    render("{{#each items as it, i }}{{ i }}:{{ it }} {{/each}}", { items: ["a", "b"] }),
    "0:a 1:b ",
  );
  assert.strictEqual(
    render("{{#each items as it}}{{ it.name }}{{/each}}", { items: [{ name: "x" }] }),
    "x",
  );
  assert.strictEqual(
    render("{{#each prices as p, sku}}{{ sku }}={{ p }};{{/each}}", { prices: { a1: 4, b2: 9 } }),
    "a1=4;b2=9;",
  );
  assert.strictEqual(
    render("{{#each obj as val}}{{ val }} {{/each}}", { obj: { x: 1, y: 2 } }),
    "1 2 ",
    "key binding is optional",
  );
  assert.strictEqual(
    render("[{{#each list as it}}x{{/each}}]", { list: null }),
    "[]",
    "nullish iterates zero times",
  );
  assert.strictEqual(
    render("[{{#each list as it}}x{{/each}}]", { list: "nope" }),
    "[]",
    "non-iterable iterates zero times",
  );

  const sparse = Array(3);
  sparse[1] = "x";
  assert.strictEqual(
    render("{{#each items as it, i}}{{ i }}:{{ it }}:{{ loop.index }}/{{ loop.length }}{{/each}}", {
      items: sparse,
    }),
    "1:x:2/3",
    "holes are skipped, surrounding indexes unshifted",
  );
});

test("each else branch", () => {
  const tpl = "{{#each items as it}}<{{ it }}>{{#else}}<{{ msg }}>{{/each}}";
  assert.strictEqual(render(tpl, { items: ["a"], msg: "none" }), "<a>");
  assert.strictEqual(render(tpl, { items: [], msg: "none" }), "<none>", "empty array");
  assert.strictEqual(render(tpl, { msg: "none" }), "<none>", "missing list");
  assert.strictEqual(
    render("{{#each o as v}}{{ v }}{{#else}}empty{{/each}}", { o: {} }),
    "empty",
    "empty object",
  );
  assert.strictEqual(
    render("{{#each xs as x}}{{ x }}{{/each}}", { xs: [] }),
    "",
    "no else stays empty",
  );
});

test("each scopes and shadowing", () => {
  assert.strictEqual(
    render("{{#each items as it}}{{ prefix }}{{ it }} {{/each}}", { items: [1, 2], prefix: "#" }),
    "#1 #2 ",
  );
  assert.strictEqual(
    render("{{#each rows as row}}{{#each row as cell}}{{ cell }},{{/each}};{{/each}}", {
      rows: [[1, 2], [3]],
    }),
    "1,2,;3,;",
    "nested each shadows correctly",
  );
  assert.strictEqual(
    render("{{#each xs as v}}{{ v }}{{/each}}{{ v }}", { xs: [1], v: "outer" }),
    "1outer",
    "parent value intact",
  );
});

test("loop metadata", () => {
  assert.strictEqual(
    render("{{#each xs as x}}{{ x }}{{#if not loop.last}}, {{/if}}{{/each}}", {
      xs: ["a", "b", "c"],
    }),
    "a, b, c",
  );
  assert.strictEqual(
    render("{{#each xs as x}}{{ loop.index }}/{{ loop.length }}:{{ x }} {{/each}}", {
      xs: ["a", "b"],
    }),
    "1/2:a 2/2:b ",
  );
  assert.strictEqual(
    render("{{#each xs as x}}{{#if loop.first}}[{{/if}}{{ x }}{{#if loop.last}}]{{/if}}{{/each}}", {
      xs: [1, 2, 3],
    }),
    "[123]",
  );
  assert.strictEqual(
    render("{{#each o as v}}{{ loop.index0 }}={{ v }};{{/each}}", { o: { a: 10, b: 20 } }),
    "0=10;1=20;",
  );
  assert.strictEqual(
    render("{{#each rows as r}}{{#each r as c}}{{ loop.index }}{{/each}}|{{/each}}", {
      rows: [["x", "y"], ["z"]],
    }),
    "12|1|",
    "nested loops get independent metadata",
  );
});

test("$ and @ scope anchors", () => {
  assert.strictEqual(
    render("{{#each rows as r}}{{ $.company }}:{{ @.n }};{{/each}}", {
      company: "ACME",
      rows: [{ n: 1 }, { n: 2 }],
    }),
    "ACME:1;ACME:2;",
  );
  assert.strictEqual(
    render("{{#each items as company}}{{ company }}={{ $.company }} {{/each}}", {
      company: "ROOT",
      items: ["a", "b"],
    }),
    "a=ROOT b=ROOT ",
    "$ is immune to shadowing by a loop variable of the same name",
  );
  assert.strictEqual(
    render("{{#each rows as row}}{{#each row as cell}}{{ @ }}{{/each}}|{{/each}}", {
      rows: [["x", "y"], ["z"]],
    }),
    "xy|z|",
    "@ re-points to the innermost item",
  );
  assert.strictEqual(
    render("{{ $.title }}/{{ @.title }}", { title: "T" }),
    "T/T",
    "both point at values at the root",
  );
  assert.throws(
    () => render("{{ $.constructor }}", {}),
    TypeError,
    "anchors still route through the xprsn guard",
  );
});

test("{ root, item } overrides the anchors without mutating anything", () => {
  assert.strictEqual(
    template("{{ $.a }}/{{ @.a }}")({}, { root: { a: "R" }, item: { a: "I" } }),
    "R/I",
    "distinct objects",
  );
  assert.strictEqual(template("{{ $.y }}")({}, { root: { y: "Z" } }), "Z");
  assert.throws(
    () => template("{{ @.x }}")({}, { root: {} }),
    TypeError,
    "omitting item leaves @ unbound",
  );
  assert.strictEqual(
    template("{{#each $.rows as r}}{{ @.n }};{{/each}}")(
      {},
      { root: { rows: [{ n: 1 }, { n: 2 }] } },
    ),
    "1;2;",
    "#each re-points @ to the current item, not the injected root",
  );

  const values = { title: "T", rows: [{ n: 1 }] };
  render("{{ $.title }}{{#each rows as r}}{{ @.n }}{{/each}}", values);
  notOk("$" in values, "$ is never written to the values object");
  notOk("@" in values, "@ is never written to the values object");
  assert.deepStrictEqual(values, { title: "T", rows: [{ n: 1 }] }, "values come back unchanged");

  const bare = {},
    root = { title: "T" },
    item = { n: 1 };
  template("{{ $.title }}/{{ @.n }}")(bare, { root, item });
  assert.deepStrictEqual(
    [root, item, bare],
    [{ title: "T" }, { n: 1 }, {}],
    "an override mutates nothing either",
  );
});

test("whitespace trimming and comments", () => {
  assert.strictEqual(render('a  {{- "x" }}  b'), "ax  b", "left trim only");
  assert.strictEqual(render('a  {{ "x" -}}  b'), "a  xb", "right trim only");
  assert.strictEqual(render('a\n\t{{- "x" -}}\n\tb'), "axb", "both sides, across newlines");
  assert.strictEqual(
    render("<ul>\n{{#each xs as x -}}\n<li>{{ x }}</li>\n{{-/each}}\n</ul>", { xs: [1, 2] }),
    "<ul>\n<li>1</li><li>2</li>\n</ul>",
    "block and closing tags trim their own sides",
  );
  assert.strictEqual(
    render('a {{ "x" -}}{{ "y" }} z'),
    "a xy z",
    "right trim does not cross an adjacent tag",
  );
  assert.strictEqual(render("a  {{- unclosed"), "a  {{- unclosed", "an unclosed tag does not trim");
  assert.strictEqual(
    render("{{ -n }}", { n: 5 }),
    "-5",
    "a dash away from the brace stays a unary minus",
  );
  assert.strictEqual(render('a  {{ "x" }}  b'), "a  x  b", "no dashes, no trimming");
  assert.strictEqual(render("a{{! this disappears }}b"), "ab", "comments");
});

test("compile once, render many, with a function registry", () => {
  const greet = template("Hi {{ name }}");
  assert.strictEqual(greet({ name: "A" }), "Hi A");
  assert.strictEqual(greet({ name: "B" }), "Hi B");
  assert.strictEqual(greet(), "Hi ", "values argument is optional");
  assert.strictEqual(
    render("{{ fmt(price) }}", { price: 4.5 }, { fmt: (n) => "€" + n.toFixed(2) }),
    "€4.50",
  );
  assert.strictEqual(
    render("{{#if gt(a, b)}}bigger{{/if}}", { a: 2, b: 1 }, { gt: (a, b) => a > b }),
    "bigger",
  );
});

test("names", () => {
  assert.deepStrictEqual(template("{{ a }} and {{ b.c }}").names, ["a", "b"]);
  assert.deepStrictEqual(
    template("{{ title }}{{#each items as it, i}}{{ i }}:{{ it.name }} vs {{ other }}{{/each}}")
      .names,
    ["title", "items", "other"],
    "loop variables are excluded",
  );
  assert.deepStrictEqual(
    template("{{ x }}{{#each xs as x}}{{ x }}{{/each}}{{ y }}").names,
    ["x", "xs", "y"],
    "free use outside still counts",
  );
  assert.deepStrictEqual(
    template("{{#each xs as it}}{{ it }}{{#else}}{{ fallback }}{{/each}}").names,
    ["xs", "fallback"],
    "the empty branch is outside the loop scope",
  );
  assert.deepStrictEqual(
    template("{{#if f(n)}}x{{/if}}", { f: (v) => v }).names,
    ["n"],
    "functions are not names",
  );
  assert.deepStrictEqual(
    template("{{ $.a }}{{#each xs as x}}{{ @.b }}{{/each}}").names,
    ["xs"],
    "anchors are excluded",
  );
  assert.deepStrictEqual(
    template("{{#each xs as x}}{{ loop.index }}{{/each}}").names,
    ["xs"],
    "loop is engine-bound inside a loop",
  );
  assert.deepStrictEqual(
    template("{{ loop }}").names,
    ["loop"],
    "and an ordinary name outside one",
  );
  assert.deepStrictEqual(template("static only").names, []);
});

test("{ bound } keeps host names out of names without unbinding them", () => {
  const tpl = template("{{ run.total }}/{{ x }}", undefined, { bound: ["run"] });
  assert.deepStrictEqual(tpl.names, ["x"], "a bound name is not reported");
  assert.strictEqual(tpl({ run: { total: 5 }, x: "a" }), "5/a", "it still resolves normally");
  assert.deepStrictEqual(
    template("{{ page.number }}{{#each xs as x}}{{ x }}{{ group.key }}{{/each}}", undefined, {
      bound: new Set(["page", "group"]),
    }).names,
    ["xs"],
    "any iterable works, inside and outside loops",
  );
  assert.deepStrictEqual(
    template("{{#each xs as page}}{{ page }}{{/each}}{{ page }}", undefined, {
      bound: ["page"],
    }).names,
    ["xs"],
    "a loop variable may shadow a bound name",
  );
  assert.deepStrictEqual(template("{{ a }}", undefined, {}).names, ["a"], "bound is optional");
});

test("scoped renders over a scope that already carries the anchors", () => {
  const root = { title: "T" };
  const scope = Object.create(null);
  scope["$"] = root;
  scope.plain = "p";
  assert.strictEqual(
    template("{{ $.title }}/{{ plain }}").scoped(scope),
    "T/p",
    "$ and free names resolve from the scope chain itself",
  );
  const row = Object.create(scope);
  row["@"] = { n: 1 };
  assert.strictEqual(
    template("{{ $.title }}:{{ @.n }}").scoped(row),
    "T:1",
    "@ resolves from the chain where the embedder bound it",
  );
  assert.throws(
    () => template("{{ @.x }}").scoped(scope),
    TypeError,
    "a scope without @ leaves it unbound, so @.x throws",
  );
  assert.strictEqual(
    template("{{#each $.rows as r}}{{ @.n }};{{/each}}").scoped(
      Object.assign(Object.create(null), { $: { rows: [{ n: 1 }, { n: 2 }] } }),
    ),
    "1;2;",
    "#each still re-points @ inside its body",
  );
  template("{{ plain }}{{#each $.rows as r}}{{ r }}{{/each}}").scoped(scope);
  assert.deepStrictEqual(root, { title: "T" }, "the caller's objects come back unchanged");
  assert.ok(!("@" in scope), "scoped never writes an anchor onto the scope");
});

test("functions", () => {
  const fns = { fmt: (n) => n, sum: (xs) => xs, upper: (s) => s };
  assert.deepStrictEqual(template("{{ fmt(price) }}", fns).functions, ["fmt"]);
  assert.deepStrictEqual(
    template("{{ fmt(a) }}{{#if sum(xs) > 0}}{{ fmt(b) }}{{/if}}", fns).functions,
    ["fmt", "sum"],
    "collected across tags and blocks, deduplicated",
  );
  assert.deepStrictEqual(
    template("{{ name.toUpperCase() }}").functions,
    [],
    "methods are not registry functions",
  );
  assert.deepStrictEqual(template("{{ a }} and {{ b }}").functions, [], "no calls, no functions");
});

test("a full template end to end", () => {
  const out = template(
    "<h1>{{ user.name }}</h1><ul>{{#each items as it}}<li>{{ it.name }}: {{ it.price * it.qty }}{{#if it.qty > 1}} ({{ it.qty }}x){{/if}}</li>{{/each}}</ul>{{#if total >= 100}}<p>Free shipping</p>{{#else}}<p>{{ fmt(shipping) }}</p>{{/if}}",
    { fmt: (n) => "€" + n.toFixed(2) },
  )({
    user: { name: "Robin" },
    items: [
      { name: "Koffie", price: 8, qty: 2 },
      { name: "Thee", price: 3, qty: 1 },
    ],
    total: 19,
    shipping: 4.95,
  });
  assert.strictEqual(
    out,
    "<h1>Robin</h1><ul><li>Koffie: 16 (2x)</li><li>Thee: 3</li></ul><p>€4.95</p>",
  );
});
