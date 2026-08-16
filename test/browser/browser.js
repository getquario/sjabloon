import { isDiagnostic, template as tokenTemplate, text } from "/lib/index.js";
import { isDiagnostic as htmlIsDiagnostic, render, template } from "/lib/html.js";

const result = document.querySelector("#result");
const rendered = document.querySelector("#rendered");
const violations = [];

document.addEventListener("securitypolicyviolation", (event) => {
  violations.push(`${event.violatedDirective}: ${event.blockedURI}`);
});

const assert = (value, message) => {
  if (!value) throw Error(message);
};

const throwsTypeError = (source, values) => {
  try {
    render(source, values);
  } catch (error) {
    return error instanceof TypeError;
  }
  return false;
};

try {
  const view = template(
    "<h1>{{ title }}</h1><ul>{{#each rows as row}}<li>{{ row }}</li>{{/each}}</ul>",
  );
  rendered.innerHTML = view({ title: "Report & totals", rows: ["one", "two"] });
  assert(rendered.textContent === "Report & totalsonetwo", "ordinary render failed");
  assert(rendered.querySelectorAll("li").length === 2, "each block failed");

  globalThis.__sjabloonPwned = false;
  rendered.innerHTML = render("{{ payload }}", {
    payload: '<img src=x onerror="globalThis.__sjabloonPwned=true">',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(!rendered.querySelector("img"), "escaped interpolation created markup");
  assert(globalThis.__sjabloonPwned === false, "template input executed script");

  for (const source of [
    '{{ value.constructor.constructor("globalThis.__sjabloonPwned=true") }}',
    '{{ value["__proto__"] }}',
    "{{ value.prototype }}",
  ])
    assert(throwsTypeError(source, { value: {} }), `escape was not blocked: ${source}`);
  assert(globalThis.__sjabloonPwned === false, "expression input executed script");

  let helperCalled = false;
  assert(
    render(
      "{{ capability() }}",
      {},
      {
        capability: () => {
          helperCalled = true;
          return "allowed";
        },
      },
    ) === "allowed" && helperCalled,
    "registered helper was not callable",
  );

  // The token entry, against the real built bundle under CSP.
  const cell = tokenTemplate("{{ product }}")({ product: "Koffie & Thee" });
  assert(
    cell.length === 1 && cell[0].value === "Koffie & Thee",
    "token entry did not emit one bare value",
  );
  assert(text(cell) === "Koffie & Thee", "text() did not join the stream unescaped");

  // Two entry bundles, one core chunk. If the core were ever inlined per
  // entry they would hold separate WeakSets, and diagnostics would stop
  // authenticating across entries.
  assert(isDiagnostic === htmlIsDiagnostic, "entries do not share one core instance");

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(violations.length === 0, `CSP violation: ${violations.join(", ")}`);
  result.dataset.status = "passed";
  result.textContent = "passed";
} catch (error) {
  result.dataset.status = "failed";
  result.textContent = error.stack || String(error);
}
