# Embedding sjabloon

For hosts that compile templates out of a larger document — a cell in a report, a
field in a form, a block in a page builder — and that need to seed their own
scope chain, introspect templates, drive an editor, or report faults in their own
coordinates.

None of this is needed to render templates. [README.md](README.md) covers the
ordinary surface: the editions, the syntax, `template`, `render`, and the error
codes.

- [Seeding the anchors](#seeding-the-anchors)
- [`renderer.scoped(values)`](#rendererscopedvalues)
- [Introspection](#introspection)
  - [`options.bound`](#optionsbound)
  - [`reads`](#reads)
- [Diagnostic identity](#diagnostic-identity)
- [`relocate(diagnostic, options)`](#relocatediagnostic-options)
- [The token contract](#the-token-contract)
  - [`display(value)`](#displayvalue)

## Seeding the anchors

By default the two anchors both point at the values you pass: `$` is the root and
`@` is the current `{{#each}}` item, which outside a loop is the root as well.
That is what an ordinary caller wants, and it needs no extra argument.

An engine with its own scope model usually wants them seeded from distinct
objects. Pass `{ root, item }` as the renderer's second argument:

```js
const tpl = template("{{ $.report }} / {{ @.row }}");

tpl(base, { root: reportRoot, item: currentRow }); // $ = reportRoot, @ = currentRow
tpl(base, { root: reportRoot }); // no item → @.x throws
```

Omitting `item` leaves `@` unbound, so `@.x` throws where there is no current
item. That is the useful behaviour for a banded report: a group header has no
representative row, and an unbound `@` turns a mistake into an error instead of a
silently plausible number. `{{#each}}` still re-points `@` to the current item
inside its body either way.

## `renderer.scoped(values)`

The trusted-scope render, for an embedder whose scope chain already binds the
anchors. The default call wraps `values` in a fresh scope and seeds `$` and `@`
into it; `scoped` skips the wrapper. `$` and `@` resolve from `values` itself,
and a chain that omits `@` leaves it unbound. `{{#each}}` still re-points `@`
inside its body, and nothing is ever written to your objects.

```js
const row = Object.create(base); // base binds $ once per render
row["@"] = item;
tpl.scoped(row);
```

Rendering one template per cell per row over scopes you already build, this is
the path with zero per-call allocations beyond the output.

## Introspection

Every renderer carries `names` and `functions`, documented in the
[README](README.md#templatestr-functions-options). The two below are for
validators and editors.

### `options.bound`

`options.bound` lists names your engine already has in scope — a loop variable, a
handle, a `page` anchor. They are excluded from `names` and still resolve
normally at render time, the same contract as
[xprsn's own `bound`](https://github.com/getquario/xprsn/blob/main/EMBEDDING.md#optionsbound):

```js
template("{{ run.total }} of {{ count }}", undefined, { bound: ["run"] }).names;
// => ['count']
```

Without it, every stored template would appear to depend on variables its author
never supplied, and a schema check like `tpl.names.every(n => n in model)` would
reject valid templates.

### `reads`

`reads` is every root-name read with its span in the template source, in source
order. Duplicates, anchors, loop variables and bound names are all kept — `names`
is the free, deduplicated view.

```js
template("{{ title }}: {{ total }}").reads;
// => [{ name: 'title', start: 3, end: 8 }, { name: 'total', start: 16, end: 21 }]
```

Spans are offsets into the original template, not into the expression inside the
tag, so an editor can squiggle, hover, and jump straight from them. An unknown
variable is not an error — it renders empty — so an editor that wants to warn
about typos has to do it from `reads` against a known data model.

## Diagnostic identity

`isDiagnostic(error)` returns `true` only for errors produced or translated by
the same sjabloon module instance. It is an identity check, not a shape check:
copying a documented `code`, `start`, `end`, and `blocks` onto another error does
not authenticate it, and a diagnostic from another installed copy returns
`false`. All three editions share one core, so mixing them in a single process is
safe — an error thrown through `sjabloon/html` authenticates through `sjabloon`.

That matters because a host has to tell three kinds of failure apart:

1. sjabloon's own faults, which have a span in the template;
2. errors thrown by _your_ registered functions, getters, methods, or coercion
   hooks, which sjabloon passes through unchanged and does not annotate;
3. everything else.

Only the first can be pointed at a source location.

Every renderer also carries its own `isDiagnostic(error)`, `true` only for
runtime diagnostics thrown through _that_ renderer. An embedder holding many
compiled templates asks the one that just rendered, so a diagnostic that leaked
from an unrelated template is not mistaken for this cell's. Compile-time
diagnostics happen before a renderer exists, so they authenticate only through
the module-wide predicate.

## `relocate(diagnostic, options)`

An embedder that compiles templates out of a larger document reports the fault in
its own coordinates, not the template's.
`relocate(diagnostic, { prefix, offset })` returns the copy to re-throw:

```js
import { isDiagnostic, relocate, template } from "sjabloon";

try {
  template(cell.value);
} catch (error) {
  if (!isDiagnostic(error)) throw error;
  throw relocate(error, { prefix: "detail.cells[0].value: " });
}
```

The copy keeps the original's class, prepends `prefix` to the message verbatim,
moves the span, and carries every other field across by
descriptor — including the frozen `blocks` context, which stays frozen and
non-writable on the copy. `blocks` is the same array, so its openers' own
`start`/`end` stay in template coordinates while the error's span moves.

The copy is registered exactly as the original was, so it passes `isDiagnostic`.
An expression fault is an xprsn diagnostic that sjabloon translated into template
coordinates; relocating it goes through xprsn, so the copy stays authentic to
both packages just as the original is. The original is left untouched. Passing
anything but a sjabloon diagnostic throws a `TypeError`.

`offset` shifts the span, and it is right whenever the template was a verbatim
slice of your text. It is wrong when your text was **decoded** first — a template
read out of a JSON string literal, where an escape makes every later offset
slide. There is no offset that fixes that, so name the region the template came
from instead:

```js
throw relocate(error, { prefix: "cells[3].template: ", span: [16, 41] });
```

`span` replaces the span outright and wins if you pass both. Neither option adds
a span to a diagnostic that had none.

Relocation lives here rather than in the embedder because authentication is by
identity: a copy an embedder builds itself cannot be authenticated, and a field
added to a diagnostic here would be a field the embedder's copy silently drops.

## The token contract

The root entry renders to `Token[]`, where a `Token` is either
`{ literal: string }` or `{ value: unknown }`. The guarantees a consumer can rely
on:

- **Values are pre-stringify.** `{{ total }}` holding `1000` yields the number
  `1000`, not `"1000"`, and nullish stays nullish. Stringification is deferred to
  `text()`, so a value with no primitive conversion reaches the stream intact and
  only fails when something asks for text.
- **Order is render order.** Loop bodies append once per iteration, untaken
  branches append nothing, and block expressions (`#if` conditions, `#each`
  collections) never appear. They steer the render; they are not part of the
  stream.
- **Literals are the template's static runs**, one token each, never merged and
  never empty. The interleaving tells you the shape: a bare `{{ amount }}` is
  exactly one value token, while `Total: {{ amount }}` is a literal followed by a
  value. A spreadsheet cell that is _only_ a number is a different thing from one
  that happens to contain one — which is why the engine emits tokens rather than
  a string plus a list of values.
- Literal tokens are frozen and shared across loop iterations; value tokens are
  fresh per emit. Do not mutate or key a cache on a literal token's identity
  across iterations.

`text(tokens)` joins a stream the way `sjabloon/text` would have rendered it, and
the two are equal for every template and every set of values. The test suite and
the fuzzer both check that.

### `display(value)`

The scalar display rule every edition and `text()` share, exported from the root
entry for embedders that stringify token values themselves.

A valid `Date` renders as ISO 8601 UTC (`toISOString()`) — the same bytes on
every machine, where `String(date)` would bake in the host's timezone and locale.
An invalid `Date` keeps its deterministic `'Invalid Date'` form, nullish displays
empty, and everything else is `String(value)`.

Use it rather than your own `String(...)` when you consume tokens and want a
target's output to agree with `sjabloon/text` on the same template.
