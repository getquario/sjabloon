// The editions share one parser, so shared semantics are tested once in
// render.test.js. This file covers only where they actually differ: what a
// leaf interpolation emits, and whether {{{ }}} is legal.
import assert from "node:assert/strict";
import test from "node:test";
import * as html from "../lib/html.js";
import * as root from "../lib/index.js";
import * as plain from "../lib/text.js";

let caught = (fn) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  assert.fail("expected an error");
};

test("escaping is html only", () => {
  const evil = { x: "<b>&\"'</b>" };
  assert.strictEqual(html.render("{{ x }}", evil), "&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;");
  assert.strictEqual(
    html.render("{{ x }}", { x: "<script>alert(1)</script>" }),
    "&lt;script&gt;alert(1)&lt;/script&gt;",
  );
  assert.strictEqual(html.render("[{{ x }}]", { x: null }), "[]", "nullish escapes to empty");
  assert.strictEqual(html.render("[{{ missing }}]", {}), "[]", "missing escapes to empty");
  assert.strictEqual(
    plain.render("{{ x }}", evil),
    "<b>&\"'</b>",
    "the text edition is output-neutral",
  );
  assert.strictEqual(
    root.text(root.render("{{ x }}", evil)),
    "<b>&\"'</b>",
    "and so is the token edition",
  );
});

test("{{{ }}} is raw in html and a located error everywhere else", () => {
  assert.strictEqual(html.render("{{{ x }}}", { x: "<b>bold</b>" }), "<b>bold</b>");
  assert.strictEqual(
    html.render("[{{{ missing }}}]", {}),
    "[]",
    "nullish is empty through the raw form too",
  );
  assert.strictEqual(
    html.render("a {{{- html -}}} b", { html: "<i>" }),
    "a<i>b",
    "raw tags trim too",
  );

  for (const mod of [root, plain]) {
    const e = caught(() => mod.template("ab{{{ x }}}"));
    assert.ok(e instanceof SyntaxError);
    assert.strictEqual(e.code, "SJABLOON_RAW_TAG");
    assert.deepStrictEqual([e.start, e.end], [2, 11], "located at the whole tag");
    assert.strictEqual(mod.isDiagnostic(e), true, "authenticated like any other diagnostic");
  }
});

// Every edition resolves to one shared core, so a diagnostic thrown through any
// of them authenticates through all of them — and stays unforgeable.
test("diagnostics are shared across editions", () => {
  const e = caught(() => html.template("{{#if ok}}yes"));
  assert.strictEqual(root.isDiagnostic(e), true);
  assert.strictEqual(plain.isDiagnostic(e), true);
  assert.strictEqual(root.isDiagnostic(Error("spoof")), false);
});

// This is what makes sjabloon/text definable as "the string edition of the
// token stream", and it is also the render fuzzer's differential oracle.
test("text(tokens) equals the plain-string render", () => {
  const CASES = [
    "",
    "plain text",
    "a{{ x }}b",
    "{{ n }}{{ d }}{{ o }}",
    "{{ x }}{{ x }}",
    "{{#if ok}}{{ a }}{{#elif alt}}{{ b }}{{#else}}{{ c }}{{/if}}",
    "{{#each xs as it, i}}{{ i }}:{{ it }};{{/each}}",
    "{{#each xs as it}}{{ it }}{{#else}}{{ fallback }}{{/each}}",
    "{{#each rows as r}}{{ $.t }}/{{ @.n }}{{#each r.cs as c}}{{ loop.index }}{{ c }}{{/each}}{{/each}}",
    'a  {{- "x" -}}  b',
    "a{{! c }}b",
    "{{ fmt(n) }}",
  ];
  const VALUES = [
    {},
    {
      x: "v",
      n: 1000,
      d: null,
      o: { a: 1 },
      ok: true,
      alt: true,
      a: "A",
      b: "B",
      c: "C",
      xs: [1, 2],
      t: "T",
      fallback: "F",
      rows: [{ n: 1, cs: ["p"] }],
    },
    { x: "<b>&\"'", xs: [], ok: false, alt: false, rows: [], n: 0 },
  ];
  const funcs = { fmt: (v) => "€" + Number(v ?? 0).toFixed(2) };

  for (const src of CASES) {
    for (const values of VALUES) {
      assert.strictEqual(
        root.text(root.template(src, funcs)(values)),
        plain.template(src, funcs)(values),
        src,
      );
    }
  }
});

test("every edition displays a Date as ISO 8601 UTC", () => {
  const values = { d: new Date("2026-01-02T00:30:00Z") };
  assert.strictEqual(plain.template("{{ d }}")(values), "2026-01-02T00:30:00.000Z");
  assert.strictEqual(html.template("{{ d }}")(values), "2026-01-02T00:30:00.000Z");
  assert.strictEqual(
    html.template("{{{ d }}}")(values),
    "2026-01-02T00:30:00.000Z",
    "the raw form uses the same display rule",
  );
  assert.strictEqual(
    root.text(root.template("{{ d }}")(values)),
    "2026-01-02T00:30:00.000Z",
    "the token join agrees with the string editions",
  );
});
