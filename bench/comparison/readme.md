# Comparison benchmarks

This manual suite compares sjabloon's published build with Tempura, Handlebars,
and Mustache. It is for understanding performance trade-offs, not declaring a
universal winner.

## Results (2026-07-22)

One run on Node v24.15.0, macOS arm64. Versions: sjabloon 0.5.0,
Tempura 0.4.1, Handlebars 4.7.9, and Mustache 4.2.0. Values are median
operations per second; the parenthesized number is throughput relative to
sjabloon.

| Workload | sjabloon | Tempura | Handlebars | Mustache |
| --- | ---: | ---: | ---: | ---: |
| Cold raw, 10 rows | 141,282 (1.00x) | 449,340 (3.18x) | 11,625 (0.08x) | 181,530 (1.28x) |
| Cold escaped, 10 rows | 92,425 (1.00x) | 201,064 (2.18x) | 13,360 (0.14x) | 110,098 (1.19x) |
| Hot raw, 10 rows | 273,377 (1.00x) | 4,023,469 (14.72x) | 702,353 (2.57x) | 676,996 (2.48x) |
| Hot raw, 1,000 rows | 4,299 (1.00x) | 47,511 (11.05x) | 11,908 (2.77x) | 8,505 (1.98x) |
| Hot escaped, 10 rows | 129,849 (1.00x) | 327,335 (2.52x) | 178,732 (1.38x) | 181,501 (1.40x) |
| Hot escaped, 1,000 rows | 1,579 (1.00x) | 3,419 (2.17x) | 2,045 (1.30x) | 1,880 (1.19x) |

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
