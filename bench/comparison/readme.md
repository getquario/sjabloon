# Comparison benchmarks

This manual suite compares sjabloon with Tempura, Handlebars, and Mustache. It
is for understanding performance trade-offs, not declaring a universal winner.

Competitors render strings, so the two **string editions** are what compare like
for like: `sjabloon/text` for the raw workload and `sjabloon/html` for the
escaped one. The template source is identical between them — only the edition
differs. The root entry is not benchmarked here: it emits `Token[]` rather than
a string, so there is nothing to compare byte for byte.

## Results (2026-09-21)

One run on Node v24.18.0, macOS arm64. Versions: sjabloon 0.14.0,
Tempura 0.4.1, Handlebars 4.7.9, and Mustache 4.2.0. Values are median
operations per second; the parenthesized number is throughput relative to
sjabloon.

| Workload                |        sjabloon |            Tempura |      Handlebars |        Mustache |
| ----------------------- | --------------: | -----------------: | --------------: | --------------: |
| Cold raw, 10 rows       | 160,454 (1.00x) |    490,671 (3.06x) |  14,236 (0.09x) | 196,631 (1.23x) |
| Cold escaped, 10 rows   | 102,543 (1.00x) |    204,115 (1.99x) |  14,042 (0.14x) | 111,875 (1.09x) |
| Hot raw, 10 rows        | 362,800 (1.00x) | 3,957,804 (10.91x) | 715,681 (1.97x) | 681,513 (1.88x) |
| Hot raw, 1,000 rows     |   6,337 (1.00x) |     49,298 (7.78x) |  12,110 (1.91x) |   8,733 (1.38x) |
| Hot escaped, 10 rows    | 160,776 (1.00x) |    329,550 (2.05x) | 180,900 (1.13x) | 179,607 (1.12x) |
| Hot escaped, 1,000 rows |   2,102 (1.00x) |      3,462 (1.65x) |   2,093 (1.00x) |   1,896 (0.90x) |

Against 0.13.0 — measured on this machine with this script — the escaped rows
run 4% to 15% faster, because `esc` now drives its scan from one regex loop
rather than a callback per character; the 1,000-row escaped render gains the
most. The raw rows land within 2% either way. Tables recorded before 0.13.0
described a single string edition and a build of `src/`, so they are not
carried forward as a baseline.

The native-prepare diagnostic is omitted because the engine APIs do different
amounts of work at that stage.

## Run

Install the isolated benchmark dependencies once:

```sh
npm --prefix bench/comparison install
```

Then run from the repository root:

```sh
npm run bench:comparison
```

The command benchmarks `lib/index.js` directly — there is no build. Competitor
dependencies live under this directory, so a normal root install and CI do not
install them.

## Measurements

- **Cold compile + render** measures the runtime-template path end to end.
- **Hot render** prepares and warms each renderer before timing it.
- **Native prepare** is diagnostic only. The APIs are not equivalent:
  sjabloon and Tempura compile eagerly, Handlebars defers compilation until its
  first render, and Mustache parses into a cache rather than returning a
  renderer.

Each renderer must first produce byte-for-byte identical output. The escaped
fixture uses `&` and `"` because all four engines escape those characters to
the same entities. Samples use adaptive batches, rotate engine order, and
report median throughput plus the full sample range.

`1.50x sjabloon` means the engine completed 1.5 times as many operations per
second as sjabloon in that workload. Ratios can exaggerate tiny absolute
differences, and results vary with Node version, hardware, power state, and
background activity. Compare repeated runs on the same machine.

This suite runs under normal Node because Tempura and Handlebars generate code
while compiling runtime templates. The existing `npm run bench` remains the
zero-dependency regression benchmark and runs under the repository's strict-CSP
simulation.
