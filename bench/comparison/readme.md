# Comparison benchmarks

This manual suite compares sjabloon with Tempura, Handlebars, and Mustache. It
is for understanding performance trade-offs, not declaring a universal winner.

Competitors render strings, so the two **string editions** are what compare like
for like: `sjabloon/text` for the raw workload and `sjabloon/html` for the
escaped one. The template source is identical between them — only the edition
differs. The root entry is not benchmarked here: it emits `Token[]` rather than
a string, so there is nothing to compare byte for byte.

## Results (2026-08-16)

One run on Node v24.18.0, macOS arm64. Versions: sjabloon 0.7.0,
Tempura 0.4.1, Handlebars 4.7.9, and Mustache 4.2.0. Values are median
operations per second; the parenthesized number is throughput relative to
sjabloon.

| Workload | sjabloon | Tempura | Handlebars | Mustache |
| --- | ---: | ---: | ---: | ---: |
| Cold raw, 10 rows | 178,949 (1.00x) | 483,076 (2.70x) | 13,728 (0.08x) | 198,490 (1.11x) |
| Cold escaped, 10 rows | 105,340 (1.00x) | 205,353 (1.95x) | 13,811 (0.13x) | 111,663 (1.06x) |
| Hot raw, 10 rows | 380,619 (1.00x) | 4,123,696 (10.83x) | 722,157 (1.90x) | 683,304 (1.80x) |
| Hot raw, 1,000 rows | 7,326 (1.00x) | 49,026 (6.69x) | 12,073 (1.65x) | 8,895 (1.21x) |
| Hot escaped, 10 rows | 150,419 (1.00x) | 333,899 (2.22x) | 183,846 (1.22x) | 184,984 (1.23x) |
| Hot escaped, 1,000 rows | 1,889 (1.00x) | 3,471 (1.84x) | 2,071 (1.10x) | 1,902 (1.01x) |

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
