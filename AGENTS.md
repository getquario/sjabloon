# sjabloon

Tiny, CSP-safe template engine powered by xprsn. Plain JS + JSDoc. `lib/core.js` is the engine; `lib/index.js`, `lib/text.js`, and `lib/html.js` are the three entries.

Work is done when `npm run check` is green. Scripts live in `package.json`. Run them on Node: Bun accepts `--disallow-code-generation-from-strings` but does not enforce it. A single suite is `node --disallow-code-generation-from-strings --test test/render.test.js`. Public syntax and API live in `README.md`.

## Architecture

`lex()` is a linear `indexOf` scanner, not a regex. Dashes must hug the braces so `{{ -price }}` stays a unary minus. The `triple` latch turns off once `}}}` is gone so `{{{…}}×N` never rescans to EOF; a ReDoS test pins that O(n) bound. Tokens are `[kind, body, tagStart, tagEnd, bodyStart]`, kind `0`/`1`/`2` = text/raw/escaped.

A recursive parser turns blocks into closures. Every expression goes through `compileExpr()`, which wraps xprsn's `compile`. No AST, no string-to-code path.

Nodes are `(scope, acc) => void`. They append into one accumulator the root wrapper creates per render. `run()` is profile-blind; only the three node builders differ per edition.

`make(profile)` binds the parser to `[lit, val, raw, seed, take]`, a positional tuple because oxc does not mangle property names. `raw` is `0` in editions that reject `{{{ }}}`. The profile is read only while parsing and baked into node closures. Parser state stays module-level in `core.js`, which keeps the diagnostics WeakSet a single shared instance.

Three entries importing one `./core.js` is what makes `isDiagnostic` work across editions. `test/browser/browser.js` asserts `isDiagnostic === htmlIsDiagnostic` after loading two entries over HTTP.

`#each` scopes are `Object.create(parent)` with the loop variable as an own key, so xprsn's lookup walks outer variables for free.

`v = v || EMPTY` in the root wrapper is load-bearing. `EMPTY` is one frozen module-level object; a fresh `{}` per render gives each wrapper a new hidden class and xprsn's name lookups go megamorphic (measured 688 ns vs 56 ns when `values` is omitted). That is the embedder shape (`{ root, item }`, no `values`).

## Safety

- Compose closures that already exist in the shipped source. Source-scan tests grep `lib/` for `\beval\b`, `Function(`, and `new Function`, so comments in `lib/` have to avoid those spellings. The suite runs under `--disallow-code-generation-from-strings`.
- Escaping lives in `lib/html.js`. That edition HTML-escapes `{{ }}` (`& < > " '`); raw output is explicit `{{{ }}}`. The other two editions escape nothing. Do not let `esc` drift into `core.js`.
- Every expression goes through xprsn's `compile`. The `get()` guard stays single-sourced there.
- `isDiagnostic` is a WeakSet. A forged `code`/`start`/`end`/`blocks` must not authenticate; a `Symbol.for` brand is not an acceptable trade.

Size is a soft goal (budgets in `package.json`, `xprsn` ignored so the number is sjabloon's own code). Name bindings for readers; a consumer minifier mangles them anyway, and `lib/` ships verbatim so those names show up in stack traces. Property names do not mangle: the accumulator's `.text` is worth its bytes. Keep escaping, the guard, and the passing test; then check `npm run size`.

## Semantics

`test/` is the executable spec. These look like bugs if you tidy them:

- `null`/`undefined` interpolate as empty strings in the string editions. The token edition carries them through; `text()` applies the same `?? ''`.
- Malformed or unclosed tags and bad expressions throw `SyntaxError` at compile time. Runtime `TypeError` comes from xprsn. `{{{ }}}` outside `sjabloon/html` is `SJABLOON_RAW_TAG`, rejected in the parser, not the lexer: the lexer must still tokenize `}}}` in every edition or the `triple` latch (and its linearity) is lost.
- Loop variables shadow outer names. `#each` walks `[value, key]` pairs (array indexes or own object keys). Nullish or non-iterable collections iterate zero times; an empty collection renders `{{#else}}` in parent scope if present.
- `$` is root values, `@` is the current `#each` item (root outside any loop). Both are pre-seeded into `bound`, so they never appear in `names`. The renderer takes an optional `{ root, item }` that overrides the anchors without mutating the caller's object. Omitting `item` (`'item' in o`) leaves `@` unbound, so `@.x` throws; the default (no second arg) keeps `$` = `@` = values.
- Token stream: `{ literal: string } | { value: unknown }`. One literal token per static text run, never merged, never empty. Literal tokens are hoisted and frozen at compile time (reference-identical across iterations); value tokens are fresh per emit. Block expressions never appear in the stream. The accumulator is local to the render call, so re-entrancy is free.
- `text(root(v))` must equal `textEntry(v)` for every template and values (unit property and the render fuzzer's oracle). The token edition defers stringification, so values the string editions cannot convert fail at `text()`; the invariant is about the join.
- Inside `#each`, `loop` = `{ index` (1-based), `index0`, `first`, `last`, `length }` on the child scope, bound like the loop variables.
- `#elif` requires a space and an expression. Whitespace trimming is per side and only when the dash hugs the brace.
- `names` / `functions` aggregate xprsn's per-expression sets in `compileExpr()`. Use `Array.from` to turn those Sets into arrays; a Set spread breaks under the bundler's transpile. The else-branch of `#each` is outside the loop scope.

## Conventions

Omakase: one obvious path over knobs. Test the guarantee a user relies on. Add complexity when concrete pressure shows up.

- oxfmt owns formatting on its defaults. `npm run fmt`.
- Comments only where the code cannot: safety rationale, non-obvious tricks.
- Bindings named for readers (`scope`, `acc`, `compileExpr`, `tokens`). Rename with a scope-aware tool: a bare `v` or `o` also lives in unrelated closures, and `{ x }` shorthand renames the property.
- Tests are `node:test` in `test/*.test.js`, run against `lib/`. Shared template meaning lives in `render.test.js` (via `sjabloon/text`). Where the three editions actually differ lives in `editions.test.js`. Token-stream shape lives in `tokens.test.js`. Diagnostics in `errors`, CSP and guards in `safety`. New shared behaviour belongs in `render.test.js`. New syntax or a new guard also belongs in `fuzz/structured.fuzz.js`.
- Treat the language as original. Leave Symfony unmentioned in code, comments, and docs.
- ESM only. Two module formats would split the diagnostics WeakSet across a `require` / `import` seam.
- Conventional Commits, at most 80 characters.
- Declarations are hand-written in `lib/` (`types.d.ts` shared; each entry re-exports it and declares only its `template`/`render` return). Hang prose on the shared types, not on each `template`. Generating them fails three ways: `isolatedDeclarations` rejects `export const { template, render } = make(...)`; plain emit resolves JSDoc-typedef-only modules to `undefined` and exits 0; `stripInternal` does not strip JSDoc `@typedef`, so `Tok` and `Node` would ship as API. `checkJs` under `strict` keeps the pair honest: `fault()` takes `SjabloonErrorCode`, so a thrown code `types.d.ts` omits fails `npm run test:types`.
- `translated` is `const` with `@type {(…) => never}` so its catch block is terminal.
- Suppress `no-unused-expressions` on the expression that trips it (`cond || fault()`, the `LIT = lit, VAL = val, RAW = raw` sequence) with `// oxlint-disable-next-line` directly above it. oxfmt moves lines, so a trailing `-line` comment slips off its target. Leave the rule live in `.oxlintrc.json`. Type-aware suppressions use the `typescript/` prefix the diagnostic reports.
- `oxlint-tsgolint` is the binary that runs the type-aware rules; without it they drop silently.
- `test/types.check.ts` ends scopes with `void [...]` so type-only bindings stay live under `no-unused-vars`.
- Source-scan tests use `globSync("lib/**/*.js")`, never a hardcoded filename.
- Fallow defaults are the gate. Split and table-drive until shipped functions sit under them; leave `maxCognitive` and `maxCrap` alone. With no coverage file, estimated CRAP wants cyclomatic below 5. Duplicated helpers in `fuzz/` get exported. A second name in `ignoreDependencies` means a real graph edge is missing.
