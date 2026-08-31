# sjabloon

A tiny, CSP-safe template engine for JavaScript. **~1.9KB min+brotli (~3.7KB with [xprsn](https://www.npmjs.com/package/xprsn)), two tiny dependencies.**

[![NPM version](https://img.shields.io/npm/v/sjabloon.svg)](https://www.npmjs.com/package/sjabloon)
[![Build Status](https://github.com/getquario/sjabloon/actions/workflows/test.yml/badge.svg)](https://github.com/getquario/sjabloon/actions/workflows/test.yml)
[![NPM downloads](https://img.shields.io/npm/dm/sjabloon.svg)](https://www.npmjs.com/package/sjabloon)
[![Apache-2.0 license](https://img.shields.io/github/license/getquario/sjabloon.svg)](https://github.com/getquario/sjabloon/blob/main/LICENSE)

<a href="https://webstronauts.com?utm_source=github&utm_medium=readme&utm_campaign=sjabloon">
	<picture>
		<img src="https://webstronauts.com/images/sponsored-by.svg" alt="Sponsored by The Webstronauts" width="200" height="65">
	</picture>
</a>

_Sjabloon_ is Dutch for "template". It renders familiar `{{ }}` templates — interpolation, `{{#if}}`, `{{#each}}` — with full [xprsn](https://github.com/getquario/xprsn) expressions inside every tag, and never turns template text into JavaScript. There is no `eval` and no `new Function`, so templates that arrive at runtime still render under a strict Content Security Policy, where engines that compile templates to code cannot.

## Contents

- [Install](#install)
- [Usage](#usage)
- [Is sjabloon the right tool?](#is-sjabloon-the-right-tool)
- [Related packages](#related-packages)
- [Editions](#editions)
- [Syntax](#syntax)
- [API](#api)
- [The token stream](#the-token-stream)
- [Safety](#safety)
- [Content Security Policy](#content-security-policy)
- [Environments](#environments)
- [Embedding sjabloon](#embedding-sjabloon)
- [Contributing](#contributing)
- [License](#license)

## Install

```bash
npm install sjabloon
```

Node.js 22.12 or newer, ESM only. TypeScript declarations ship with the package; nothing extra to install.

## Usage

If you're rendering HTML, import the HTML edition. It escapes every interpolated value, and it is the edition most projects want:

```js
import { render } from "sjabloon/html";

render(
  `<ul>{{#each items as it, i}}
    <li>{{ i + 1 }}. {{ it.name }}: {{ fmt(it.price * it.qty) }}</li>
  {{/each}}</ul>
  {{#if total >= 100 and "vip" in user.roles}}Free shipping!{{#else}}Shipping: {{ fmt(5) }}{{/if}}`,
  { items: [{ name: "Koffie", price: 8, qty: 2 }], total: 120, user: { roles: ["vip"] } },
  { fmt: (n) => "€" + n.toFixed(2) },
);
```

`render` compiles and renders in one call. Compile once and render many times with `template`:

```js
import { template } from "sjabloon/html";

const greet = template("<p>Hello {{ name }}!</p>");

greet({ name: "Robin" }); // => '<p>Hello Robin!</p>'
greet({ name: "<script>" }); // => '<p>Hello &lt;script&gt;!</p>'
```

The third argument is your function registry. Templates can call only what you put there — there is no built-in helper library and no way for a template to reach anything you didn't pass in.

Not rendering HTML? There are two other editions with the same syntax and a different output. See [Editions](#editions).

## Is sjabloon the right tool?

sjabloon renders a template against a values object. Templates can interpolate, branch, and loop. They cannot define variables, call out to anything you didn't register, or include other templates.

**It fits when:**

- Templates arrive at runtime — edited by users, stored in a CMS or database, pulled from a config file — so you can't precompile them at build time.
- You ship under a strict CSP, or into a runtime where string-to-code is unavailable. This is the reason the package exists.
- The people writing templates are not programmers, and `{{ }}` is a syntax they already recognise.
- Bundle size is a real constraint, or you want a dependency tree you can read in an afternoon.

**Look elsewhere when:**

- Your templates are known at build time and speed matters most. Engines that generate specialised JavaScript render faster; precompiling them at build time also avoids `unsafe-eval`. See [Content Security Policy](#content-security-policy) for the measured tradeoff.
- You need partials, includes, layout inheritance, macros, or custom block tags. sjabloon has a fixed set of blocks and no composition mechanism.
- You need a sandbox or an HTML sanitizer. The HTML edition escapes interpolated values, but literal template text is copied through, and your registered functions do whatever they do. See [SECURITY.md](SECURITY.md).
- You want a component model with state and lifecycle. This renders strings, once.
- You need CommonJS, or Node older than 22.12. See [Environments](#environments).

## Related packages

sjabloon is the template layer of a set that shares one approach — parse to closures, never to code — and whose only runtime dependencies are each other and [waarmerk](https://github.com/getquario/waarmerk), the located-diagnostic module they mint through:

- **[xprsn](https://github.com/getquario/xprsn)** — the expression language sjabloon runs inside every tag, usable on its own if you need to evaluate _one_ expression against data rather than render text. Its [syntax reference](https://github.com/getquario/xprsn#syntax) is the reference for everything between the braces here.
- **[padvinder](https://github.com/getquario/padvinder)** — a JSONPath engine, if you need to _select nodes_ out of a document. Filter evaluation is the part of JSONPath that has produced real code-injection CVEs elsewhere; padvinder parses filters to closures with no route to code execution, and passes the full RFC 9535 compliance suite.

## Editions

Three entry points, one engine. They share a parser, a syntax, and a diagnostics contract, and differ only in what a render produces.

| Import          | `template(str, funcs?)` returns | `{{ expr }}` | `{{{ expr }}}` |
| --------------- | ------------------------------- | ------------ | -------------- |
| `sjabloon/html` | `(values?, scope?) => string`   | HTML-escaped | raw            |
| `sjabloon/text` | `(values?, scope?) => string`   | unescaped    | `SyntaxError`  |
| `sjabloon`      | `(values?, scope?) => Token[]`  | value token  | `SyntaxError`  |

- **`sjabloon/html`** for anything that ends up in a page or an email. Interpolated values are escaped; `{{{ expr }}}` opts out for a value you already trust.
- **`sjabloon/text`** for output with no markup — a subject line, a filename, a log format, a Markdown file. Nothing is escaped, because there is nothing to escape it for.
- **`sjabloon`** (the root entry) renders to a [token stream](#the-token-stream) instead of a string: the literal runs and the interpolated values, interleaved in render order, with values still in their original types. This is the one to reach for when the output isn't text at all — a spreadsheet cell that needs the number `1000` and a cell format, a PDF run, a structured document node.

`{{{ }}}` exists only in the HTML edition, where "raw" means something. Everywhere else `{{ }}` is already raw, so the triple form is a compile-time `SJABLOON_RAW_TAG` error rather than a silently different meaning.

Every edition exports `template`, `render`, `isDiagnostic`, and `relocate`. They all resolve to one shared core, so a diagnostic thrown through any of them authenticates through all of them, and mixing editions in one process is safe.

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

### Loop state

Inside `{{#each}}`, a `loop` object holds the iteration state: `index` (1-based), `index0`, `first`, `last`, and `length`. Use `loop.last` for separators and trailing borders, or `loop.index` with `loop.length` for "row X of Y". Each nested loop gets its own.

```js
render("{{#each xs as x}}{{ x }}{{#if not loop.last}}, {{/if}}{{/each}}", { xs: ["a", "b", "c"] });
// => 'a, b, c'
```

### Anchors

Two anchors are always in scope: `$` is the root values and `@` is the current `{{#each}}` item (the root outside a loop). They let a nested body name the level it means instead of leaning on shadowing: `$.company` reaches the top, and `@.total` is whatever the innermost loop sits on.

```js
render(
  "{{#each regions as company}}{{ company }} of {{ $.company }}: {{#each rows as r}}{{ @.n }} {{/each}}{{/each}}",
  { company: "ACME", regions: ["North", "South"], rows: [{ n: 1 }, { n: 2 }] },
);
// => 'North of ACME: 1 2 South of ACME: 1 2 '
```

Here the loop variable `company` shadows the root's for a bare name, but `$.company` still returns `'ACME'`. Anchors never count as `names`, and a blocked key through one (`$.constructor`) throws like anywhere else.

A host with its own scope model can seed the two anchors from separate objects — see [Embedding sjabloon](EMBEDDING.md#seeding-the-anchors).

## API

Identical across all three editions, except for what a render produces.

### `template(str, functions?, options?)`

Compiles the template and returns a renderer. Malformed tags, unclosed blocks, and invalid expressions throw a `SyntaxError` at compile time, so a template you compiled is a template that parses.

The renderer carries `names` — every variable the template reads from your values, loop variables and anchors excluded — and `functions`, the registry functions it calls, methods excluded. Both are deduplicated.

```js
const tpl = template("{{ fmt(title) }}{{#each items as it}}{{ it.name }}{{/each}}", {
  fmt: (s) => s,
});

tpl.names; // => ['title', 'items']
tpl.functions; // => ['fmt']
```

Use them to check a stored template against your data model and its allowed functions before you render it, or to fetch only the fields it actually needs.

Renderers carry three further members aimed at hosts: [`options.bound`](EMBEDDING.md#optionsbound) and [`reads`](EMBEDDING.md#reads) for validators and editors, and [`scoped`](EMBEDDING.md#rendererscopedvalues) for an engine that builds its own scope chain.

### `render(str, values?, functions?)`

Shorthand for `template(str, functions)(values)`, returning whatever its edition renders. Compiles on every call, so prefer `template` in a loop.

### `text(tokens)` and `display(value)` (root entry only)

`text` joins a token stream into a string the way `sjabloon/text` would have rendered it. `display` is the scalar rule both share, exported for embedders that stringify token values themselves. See [The token stream](#the-token-stream).

### Error diagnostics

Sjabloon errors keep their native `SyntaxError` or `TypeError` class and expose:

- `code`: a stable `SJABLOON_*` parser category, or the original `XPRSN_*` category for a fault inside an expression;
- `start`: a zero-based offset in the original template;
- `end`: the exclusive template offset;
- `blocks`: a frozen, outermost-first array of `{ type, start, end }` opener spans.

Together they are enough to point whoever wrote the template at the character that broke it, and `blocks` says which enclosing block it happened in:

```js
import { isDiagnostic, template } from "sjabloon";

try {
  template("{{#if a}}oops");
} catch (error) {
  if (!isDiagnostic(error)) throw error;
  error.code; // => 'SJABLOON_UNCLOSED_BLOCK'
  error.start; // => 13   (end of template — nothing closed the block)
  error.blocks; // => [{ type: 'if', start: 0, end: 9 }]
}
```

Parser codes are `SJABLOON_EACH_SYNTAX`, `SJABLOON_BLOCKED_BINDING`, `SJABLOON_UNEXPECTED_TAG`, `SJABLOON_UNKNOWN_BLOCK`, `SJABLOON_UNCLOSED_BLOCK`, `SJABLOON_RAW_TAG` (a `{{{ }}}` tag outside the HTML edition, located at the whole tag), and `SJABLOON_TOO_DEEP` (block nesting past 256 levels, located at the opener that crossed the cap; `#elif` links are not nesting and do not count). A missing closer uses an empty span at the end of the template. Expression offsets refer to the original template, so surrounding braces, whitespace, and trim markers contribute to their absolute position.

Errors thrown by registered functions, getters, methods, or value coercion hooks are host errors. Sjabloon passes them through unchanged and does not attach template diagnostic fields. `isDiagnostic(error)` is how you tell the two apart; it authenticates by identity rather than by shape, which has consequences worth knowing if you embed sjabloon — see [EMBEDDING.md](EMBEDDING.md#diagnostic-identity).

## The token stream

The root entry renders to tokens rather than a string. A render gives you the literal runs and the interpolated values, interleaved in render order:

```js
import { template, text } from "sjabloon";

const tokens = template("{{ qty }} × {{ name }}")({ qty: 2, name: "Koffie" });
// => [{ value: 2 }, { literal: ' × ' }, { value: 'Koffie' }]

text(tokens); // => '2 × Koffie'
```

Values keep their original type — `{{ total * 1.21 }}` over `{ total: 1000 }` gives you the number `1210`, not `"1210"`. That is the point: different targets need different things from the same template. HTML wants escaped text; a spreadsheet wants the number and a cell format; a PDF wants a run with a font. Escaping and stringification belong at the output edge, not in the engine, so a string is just one way to consume the stream.

If you are writing a renderer against these tokens, [EMBEDDING.md](EMBEDDING.md#the-token-contract) has the guarantees you can rely on — ordering, literal identity, and the `display` rule.

## Safety

- `sjabloon/html` escapes `& < > " '` in `{{ }}`; unescaped output requires the explicit `{{{ }}}` form. **If you are rendering HTML, import that edition.** The other two are output-neutral by design and escape nothing, on the assumption that you escape at your own output edge.
- Expressions inherit all of xprsn's guards: no `__proto__`/`constructor`/`prototype` access, null-prototype hash literals, and functions resolved only from your registry.
- Templates read your values; they cannot assign to them.
- Registered functions are host-provided capabilities, not a sandbox boundary. Only register helpers that template authors are allowed to invoke; likewise, treat explicit raw output as trusted HTML.

sjabloon is not an HTML sanitizer: literal template text is copied to the output verbatim, so a template author can always write raw markup. [SECURITY.md](SECURITY.md) has the checklist to work through before accepting templates from people you don't trust, and the process for reporting a vulnerability.

## Content Security Policy

sjabloon works under `script-src 'self'` with no `unsafe-eval`. Templates parse into a tree of closures that call other closures; xprsn compiles the expressions the same way. The test suite runs under `node --disallow-code-generation-from-strings`, which throws on any string-to-code construct exactly like a strict CSP does.

That runtime CSP support costs some render speed. Handlebars and tempura generate specialised JavaScript, so their compiled renderers are faster — but runtime compilation requires `unsafe-eval`, and build-time precompilation only avoids that when the templates are known in advance. If templates arrive at runtime and your CSP is strict, sjabloon fits; if they don't, an engine that precompiles is the faster answer. See the [comparison benchmarks](bench/comparison/) for cold-compile and hot-render numbers.

## Environments

Node.js 22.12 and newer, ESM only. Browser use is supported through a standards-based ESM bundler in environments supporting ES2024. Direct `<script>` globals, UMD, and CommonJS builds are not provided.

Shipping CommonJS alongside ESM would put two copies of the core in any process that mixed `require` and `import`. Each copy would have its own diagnostic identity, so `isDiagnostic` would return `false` across the seam.

TypeScript declarations are hand-written and ship in the package; `npm run check` runs `attw` against them.

## Embedding sjabloon

If you compile templates out of a larger document — a cell in a report, a field in a form, a block in a page builder — [EMBEDDING.md](EMBEDDING.md) covers the surface built for that: seeding the anchors from your own scope chain, `scoped` renders, introspection for validators and editors, diagnostic identity, relocating a fault into your own coordinates, and the token contract.

## Contributing

```bash
git clone https://github.com/getquario/sjabloon.git
cd sjabloon
npm install
npm run check
```

`npm run check` is the local gate: formatting, lint, dead-code and dependency checks, the size budgets, the unit and type suites, the fuzz regression corpus, and the browser CSP run. It is the same gate CI runs, so a green `check` locally means a green pull request.

Conventions for this repo — the parser, the semantics that look like bugs if you tidy them, and the commit format — live in [AGENTS.md](AGENTS.md).

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
