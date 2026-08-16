// Manual micro- and scaling benchmarks for sjabloon. Run with `npm run bench`.
import assert from 'node:assert/strict';
import { render, template } from '../lib/html.js';
import { template as tokenTemplate, text } from '../lib/index.js';
import { template as textTemplate } from '../lib/text.js';

let sink = 0;

function consume(value) {
	sink += typeof value === 'string' ? value.length : value ? 1 : 0;
}

function micro(name, fn) {
	for (let t = performance.now(); performance.now() - t < 50;) consume(fn());
	let best = 0;
	for (let sample = 0; sample < 5; sample++) {
		let ops = 0;
		const start = performance.now();
		let elapsed;
		do {
			for (let i = 0; i < 100; i++) consume(fn());
			ops += 100;
			elapsed = performance.now() - start;
		} while (elapsed < 100);
		best = Math.max(best, ops / (elapsed / 1e3));
	}
	console.log(name.padEnd(30), Math.round(best).toLocaleString().padStart(14), 'ops/sec');
}

function elapsed(name, fn) {
	consume(fn());
	let best = Infinity;
	for (let sample = 0; sample < 3; sample++) {
		const start = performance.now();
		const result = fn();
		const duration = performance.now() - start;
		consume(result);
		best = Math.min(best, duration);
	}
	console.log(name.padEnd(30), best.toFixed(3).padStart(14), 'ms');
}

const TPL = '<h1>{{ title }}</h1><ul>{{#each items as it}}<li>{{ it.name }}: {{ it.price }}{{#if not loop.last}}, {{/if}}</li>{{/each}}</ul>';
const rows = n => Array.from({ length: n }, (_, i) => ({ name: 'Item ' + i, price: i * 10 }));
const small = { title: 'Order', items: rows(10) };
const renderOrder = template(TPL);
const expected = n => `<h1>Order</h1><ul>${rows(n).map((item, i) => `<li>${item.name}: ${item.price}${i === n - 1 ? '' : ', '}</li>`).join('')}</ul>`;

assert.equal(renderOrder(small), expected(10));
assert.equal(render(TPL, small), expected(10));

console.log(`Node ${process.version} · ${process.platform} ${process.arch}`);
console.log('\nMicrobenchmarks (best of 5)');
micro('compile: template', () => template(TPL));
micro('run: 10 items', () => renderOrder(small));
micro('render: one-shot (10)', () => render(TPL, small));

// What the token edition actually costs against the string editions, on the
// same template. The single-cell case is the downstream report shape and the
// one most exposed to per-token allocation.
const cell = { product: 'Koffie' };
const htmlCell = template('{{ product }}');
const textCell = textTemplate('{{ product }}');
const tokenCell = tokenTemplate('{{ product }}');
const tokenOrder = tokenTemplate(TPL);

console.log('\nEditions: one interpolation (best of 5)');
micro('html: cell', () => htmlCell(cell));
micro('text: cell', () => textCell(cell));
micro('token: cell', () => tokenCell(cell));
micro('token: cell + text()', () => text(tokenCell(cell)));

console.log('\nEditions: 10-item order (best of 5)');
micro('html: order', () => renderOrder(small));
micro('token: order', () => tokenOrder(small));
micro('token: order + text()', () => text(tokenOrder(small)));

console.log('\nScaling, precompiled (best of 3)');
for (const size of [10, 100, 1_000]) {
	const values = { title: 'Order', items: rows(size) };
	assert.equal(renderOrder(values), expected(size));
	elapsed(`${size.toLocaleString()} items`, () => renderOrder(values));
}

if (sink < 0) console.log(sink);
