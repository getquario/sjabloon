import { renderSafe } from "./lib.js";

// A fixed values object with the shapes templates reach for: scalars, a nested
// object, and a non-empty collection so `#each` bodies actually iterate.
const VALUES = {
  a: 1,
  b: "x",
  c: true,
  n: 0,
  foo: { bar: { baz: 2 }, qty: 3 },
  items: [
    { price: 5, qty: 2 },
    { price: 7, qty: 1 },
  ],
};

export function fuzz(data) {
  renderSafe(data.toString("utf8"), VALUES);
}
