# Comparison benchmarks

This manual suite compares sjabloon with Tempura, Handlebars, and Mustache. It
is for understanding performance trade-offs, not declaring a universal winner.

Competitors render strings, so the two **string editions** are what compare like
for like: `sjabloon/text` for the raw workload and `sjabloon/html` for the
escaped one. The template source is identical between them — only the edition
differs. The root entry is not benchmarked here: it emits `Token[]` rather than
a string, so there is nothing to compare byte for byte.

## Results (2026-09-18)

One run on Node v24.18.0, macOS arm64. Versions: sjabloon 0.13.0,
Tempura 0.4.1, Handlebars 4.7.9, and Mustache 4.2.0. Values are median
operations per second; the parenthesized number is throughput relative to
sjabloon.

| Workload                |        sjabloon |            Tempura |      Handlebars |        Mustache |
| ----------------------- | --------------: | -----------------: | --------------: | --------------: |
| Cold raw, 10 rows       | 157,557 (1.00x) |    473,334 (3.00x) |  13,914 (0.09x) | 198,070 (1.26x) |
| Cold escaped, 10 rows   |  98,528 (1.00x) |    203,861 (2.07x) |  13,963 (0.14x) | 111,674 (1.13x) |
| Hot raw, 10 rows        | 369,890 (1.00x) | 4,065,327 (10.99x) | 718,317 (1.94x) | 677,419 (1.83x) |
| Hot raw, 1,000 rows     |   6,271 (1.00x) |     48,994 (7.81x) |  11,993 (1.91x) |   8,585 (1.37x) |
| Hot escaped, 10 rows    | 149,938 (1.00x) |    333,140 (2.22x) | 183,656 (1.22x) | 183,792 (1.23x) |
| Hot escaped, 1,000 rows |   1,825 (1.00x) |      3,471 (1.90x) |   2,077 (1.14x) |   1,870 (1.02x) |

The previous table was recorded against 0.7.0, which exported one string
edition and shipped a build of `src/`. Those numbers are not comparable with
these, so they are not carried forward as a baseline. Against 0.11.0 — the last
release before the parser and diagnostics refactors, measured on this machine
with this script — the hot-render rows land within 5% either way and cold
compile is about 4% slower.

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
