# sjabloon

A tiny, CSP-safe, target-neutral template engine for JavaScript. **~1.9KB min+brotli (~3.7KB with [xprsn](https://www.npmjs.com/package/xprsn)), one dependency.**

[![NPM version](https://img.shields.io/npm/v/sjabloon.svg)](https://www.npmjs.com/package/sjabloon)
[![Build Status](https://github.com/getquario/sjabloon/actions/workflows/test.yml/badge.svg)](https://github.com/getquario/sjabloon/actions/workflows/test.yml)
[![NPM downloads](https://img.shields.io/npm/dm/sjabloon.svg)](https://www.npmjs.com/package/sjabloon)
[![Apache-2.0 license](https://img.shields.io/github/license/getquario/sjabloon.svg)](https://github.com/getquario/sjabloon/blob/main/LICENSE)

<a href="https://webstronauts.com?utm_source=github&utm_medium=readme&utm_campaign=sjabloon">
	<picture>
		<img src="https://webstronauts.com/images/sponsored-by.svg" alt="Sponsored by The Webstronauts" width="200" height="65">
	</picture>
</a>

_Sjabloon_ is Dutch for "template". It renders templates with full [xprsn](https://github.com/getquario/xprsn) expressions inside every tag, without turning template text into JavaScript. There is no `eval` and no `new Function`, so it runs under a strict Content Security Policy where engines that compile templates to code cannot.

The engine emits **tokens**, not text. A render gives you the literal runs and the interpolated values, interleaved in render order. Different targets need different things from the same template: HTML wants escaped text, a spreadsheet wants the number `1000` and a cell format. Escaping belongs at the output edge, not in the engine, so a string is just one way to consume the stream.

## Install

```bash
npm install sjabloon
```

Node.js 22.12 or newer, ESM only.

## Usage

```js
import { template, text } from "sjabloon";

const cell = template("{{ total * 1.21 }}");

cell({ total: 1000 }); // => [{ value: 1210 }]      // still a number
text(cell({ total: 1000 })); // => '1210'                 // when you want the string
```

If you only want a string, import the edition that produces one directly:

```js
import { render } from "sjabloon/html"; // {{ }} HTML-escapes, {{{ }}} is raw

render(
  `<ul>{{#each items as it, i}}
    <li>{{ i + 1 }}. {{ it.name }}: {{ fmt(it.price * it.qty) }}</li>
  {{/each}}</ul>
  {{#if total >= 100 and "vip" in user.roles}}Free shipping!{{#else}}Shipping: {{ fmt(5) }}{{/if}}`,
  { items: [{ name: "Koffie", price: 8, qty: 2 }], total: 120, user: { roles: ["vip"] } },
  { fmt: (n) => "€" + n.toFixed(2) },
);
```

## Editions

Three entry points, one engine. They share a parser, a syntax, and a diagnostics contract, and differ only in what a render produces.

| Import          | `template(str, funcs?)` returns | `{{ expr }}` | `{{{ expr }}}` |
| --------------- | ------------------------------- | ------------ | -------------- |
| `sjabloon`      | `(values?, scope?) => Token[]`  | value token  | `SyntaxError`  |
| `sjabloon/text` | `(values?, scope?) => string`   | unescaped    | `SyntaxError`  |
| `sjabloon/html` | `(values?, scope?) => string`   | HTML-escaped | raw            |

`{{{ }}}` exists only in the HTML edition, where "raw" means something. Everywhere else `{{ }}` is already raw, so the triple form is a compile-time `SJABLOON_RAW_TAG` error.

Every edition exports `template`, `render`, `isDiagnostic`, and `relocate`. They all resolve to one shared core, so a diagnostic thrown through any of them authenticates through all of them.

## API

### `template(str, functions?)`

Compiles the template and returns a renderer. What it renders to depends on the edition you imported from (see [Editions](#editions)); everything else on this page is identical across all three. Malformed tags, unclosed blocks, and invalid expressions throw a `SyntaxError` at compile time.

The anchors `$` (root) and `@` (current `{{#each}}` item) work as [described below](#syntax) with no extra arguments. At the root, before any loop, both point at `values`. If you're embedding sjabloon under an engine with its own scope model, pass `{ root, item }` as the second argument to seed the two root anchors from distinct objects: `$` becomes `root` and `@` becomes `item`. Omit `item` and `@` stays unbound at the root, so reading `@.x` throws where there is no current item. Either way, `{{#each}}` still re-points `@` to the current item inside its body.

```js
const tpl = template("{{ $.report }} / {{ @.row }}");
tpl(base, { root: reportRoot, item: currentRow }); // $ = reportRoot, @ = currentRow
tpl(base, { root: reportRoot }); // no item → @.x throws
```

The renderer carries `names` (every variable the template reads from your values, loop variables excluded) and `functions` (the registry functions it calls, methods excluded), both deduplicated. Check a stored template against your data model and its allowed functions before you render it, or fetch only the fields it needs.

```js
const tpl = template("{{ fmt(title) }}{{#each items as it}}{{ it.name }}{{/each}}", {
  fmt: (s) => s,
});
tpl.names; // => ['title', 'items']
tpl.functions; // => ['fmt']
```

### `render(str, values?, functions?)`

Shorthand for `template(str, functions)(values)`, returning whatever its edition renders.

### `text(tokens)` (root entry only)

Joins a token stream the way `sjabloon/text` would have rendered it: literals verbatim, values as `String(value ?? '')`. `text(template(str)(values))` and `sjabloon/text`'s `template(str)(values)` are equal for every template and every set of values. The test suite and the fuzzer both check that.

```js
import { template, text } from "sjabloon";

const tokens = template("{{ qty }} × {{ name }}")({ qty: 2, name: "Koffie" });
// => [{ value: 2 }, { literal: ' × ' }, { value: 'Koffie' }]

text(tokens); // => '2 × Koffie'
```

A `Token` is either `{ literal: string }` or `{ value: unknown }`:

- **Values are pre-stringify.** `{{ total }}` holding `1000` yields the number `1000`, not `"1000"`, and nullish stays nullish. Stringification is deferred to `text()`, so a value with no primitive conversion reaches the stream intact and only fails when something asks for text.
- **Order is render order.** Loop bodies append once per iteration, untaken branches append nothing, and block expressions (`#if` conditions, `#each` collections) never appear. They steer the render; they are not part of the stream.
- **Literals are the template's static runs**, one token each, never merged and never empty. The interleaving tells you the shape: a bare `{{ amount }}` is exactly one value token, while `Total: {{ amount }}` is a literal followed by a value. That is why the engine emits tokens instead of a string plus a list of values. A spreadsheet cell that is _only_ a number is a different thing from one that happens to contain one.

Literal tokens are frozen and shared across loop iterations; value tokens are fresh per emit.

### Error diagnostics

Sjabloon errors keep their native `SyntaxError` or `TypeError` class and expose:

- `code`: a stable `SJABLOON_*` parser category or the original `XPRSN_*` expression category;
- `start`: a zero-based offset in the original template;
- `end`: the exclusive template offset;
- `blocks`: a frozen, outermost-first array of `{ type, start, end }` opener spans.

Parser codes are `SJABLOON_EACH_SYNTAX`, `SJABLOON_BLOCKED_BINDING`, `SJABLOON_UNEXPECTED_TAG`, `SJABLOON_UNKNOWN_BLOCK`, `SJABLOON_UNCLOSED_BLOCK`, `SJABLOON_RAW_TAG` (a `{{{ }}}` tag outside the HTML edition, located at the whole tag), and `SJABLOON_TOO_DEEP` (block nesting past 256 levels, located at the opener that crossed the cap). A missing closer uses an empty span at the end of the template. Expression offsets refer to the original template, so surrounding braces, whitespace, and trim markers contribute to their absolute position.

Unauthenticated errors thrown by registered functions, getters, methods, or value coercion hooks are host errors. Sjabloon passes them through unchanged and does not attach template diagnostic fields.

Use `isDiagnostic(error)` when a host needs to distinguish those errors. It returns `true` only for errors produced or translated by the same sjabloon module instance. Copying a documented `code`, `start`, `end`, and `blocks` onto another error does not authenticate it. A diagnostic from another installed copy or module instance returns `false`. All three editions share one core, so mixing them in a single process is safe: an error thrown through `sjabloon/html` authenticates through `sjabloon`.

#### Relocating a diagnostic

An embedder that compiles templates out of a larger document — a cell in a report, a field in a form — reports the fault in its own coordinates, not the template's. `relocate(diagnostic, { prefix, offset })` returns the copy to re-throw:

```js
import { isDiagnostic, relocate, template } from "sjabloon";

try {
  template(cell.value);
} catch (error) {
  if (!isDiagnostic(error)) throw error;
  throw relocate(error, { prefix: "detail.cells[0].value: " });
}
```

The copy keeps the original's class, prepends `prefix` to the message verbatim, shifts `start` and `end` by `offset`, and carries every other field across by descriptor — including the frozen `blocks` context, which stays frozen and non-writable on the copy. `blocks` is the same array, so its openers' own `start`/`end` stay in template coordinates while the error's span moves. It is registered exactly as the original was, so it passes `isDiagnostic` — and an expression fault, which is an xprsn diagnostic sjabloon translated into template coordinates, is relocated by xprsn so the copy stays authentic to both packages just as the original is. The original is left untouched. Relocation belongs here rather than in the embedder because authentication is by identity: a copy an embedder builds itself cannot be authenticated, and a field added to a diagnostic here would be a field the embedder's copy silently drops. Passing anything but a sjabloon diagnostic throws a `TypeError`.

## Syntax

| Tag                                                   | Meaning                                                                                                   |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `{{ expr }}`                                          | Interpolate an expression: a value token, or text escaped per edition                                     |
| `{{{ expr }}}`                                        | Interpolate raw. **`sjabloon/html` only**; a `SyntaxError` elsewhere                                      |
| `{{#if expr}} … {{#elif expr}} … {{#else}} … {{/if}}` | Conditional block, with as many `{{#elif}}` links as you need                                             |
| `{{#each expr as item}} … {{/each}}`                  | Loop over an array or an object's values                                                                  |
| `{{#each expr as item, key}} … {{/each}}`             | Second name binds the index (arrays) or the key (objects)                                                 |
| `{{#each expr as item}} … {{#else}} … {{/each}}`      | The `{{#else}}` branch renders when the collection is empty or missing                                    |
| `{{ loop.last }}` (inside `{{#each}}`)                | Iteration metadata: `index` (1-based), `index0`, `first`, `last`, `length`                                |
| `{{! anything }}`                                     | Comment, removed from output                                                                              |
| `{{- expr -}}`                                        | A dash hugging either brace trims the whitespace on that side, newlines included; works on every tag form |

Every `expr` is an [xprsn expression](https://github.com/getquario/xprsn#syntax): literals, arithmetic, string concatenation with `~` (`{{ first ~ " " ~ last }}`), comparisons, `and`/`or`/`not`/`in`, ternaries, property and method access, and functions from the registry you pass in. `null` and `undefined` render as empty strings.

A loop body sees its loop variable plus the outer scope; reusing an outer name shadows it only inside that body. The engine keeps loop variables on a child scope, so the values you pass are never mutated.

Inside `{{#each}}`, a `loop` object holds the iteration state: `index` (1-based), `index0`, `first`, `last`, and `length`. Use `loop.last` for separators and trailing borders, or `loop.index` with `loop.length` for "row X of Y". Each nested loop gets its own.

```js
render("{{#each xs as x}}{{ x }}{{#if not loop.last}}, {{/if}}{{/each}}", { xs: ["a", "b", "c"] });
// => 'a, b, c'
```

Two anchors are always in scope: `$` is the root values and `@` is the current `{{#each}}` item (the root outside a loop). They let a nested body name the level it means instead of leaning on shadowing: `$.company` reaches the top, and `@.total` is whatever the innermost loop sits on.

```js
render(
  "{{#each regions as company}}{{ company }} of {{ $.company }}: {{#each rows as r}}{{ @.n }} {{/each}}{{/each}}",
  { company: "ACME", regions: ["North", "South"], rows: [{ n: 1 }, { n: 2 }] },
);
// => 'North of ACME: 1 2 South of ACME: 1 2 '
```

Here the loop variable `company` shadows the root's for a bare name, but `$.company` still returns `'ACME'`. Anchors never count as `names`, and a blocked key through one (`$.constructor`) throws like anywhere else.

## Content Security Policy

sjabloon works under `script-src 'self'` with no `unsafe-eval`. Templates parse into a tree of closures that call other closures; xprsn compiles the expressions the same way. The test suite runs under `node --disallow-code-generation-from-strings`, which throws on any string-to-code construct exactly like a strict CSP does.

That runtime CSP support costs some render speed. Handlebars and tempura generate specialized JavaScript, so their compiled renderers are faster but runtime compilation requires `unsafe-eval`. Build-time precompilation avoids that restriction when templates are known in advance. If templates arrive at runtime (user-edited templates, CMS content, email templates) and your CSP is strict, sjabloon fits. See the [comparison benchmarks](bench/comparison/) for cold-compile and hot-render comparisons.

## Safety

- `sjabloon/html` escapes `& < > " '` in `{{ }}`; unescaped output requires the explicit `{{{ }}}` form. **If you are rendering HTML, import that edition.** The other two are output-neutral by design and escape nothing, on the assumption that you escape at your own output edge.
- Expressions inherit all of xprsn's guards: no `__proto__`/`constructor`/`prototype` access, null-prototype hash literals, and functions resolved only from your registry.
- Templates read your values; they cannot assign to them.
- Registered functions are host-provided capabilities, not a sandbox boundary. Only register helpers that template authors are allowed to invoke; likewise, treat explicit raw output as trusted HTML.

## Environments

Node.js 22.12 and newer, ESM only. Browser use is supported through a standards-based ESM bundler in environments supporting ES2024. Direct `<script>` globals, UMD, and CommonJS builds are not provided.

Shipping CommonJS alongside ESM would put two copies of the core in any process that mixed `require` and `import`. Each copy would have its own diagnostic identity, so `isDiagnostic` would return `false` across the seam.

## Contributing

```bash
git clone https://github.com/getquario/sjabloon.git
cd sjabloon
npm install
npm run check
```

`npm run check` is the local gate. Conventions for this repo live in [AGENTS.md](AGENTS.md).

## License

Copyright 2026 Robin van der Vleuten

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
