import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Handlebars from 'handlebars';
import Mustache from 'mustache';
import { compile as tempura } from 'tempura';
// The competitors all render strings, so the two string editions are what
// compare like for like — `sjabloon/text` for the raw workload, `sjabloon/html`
// for the escaped one. The template source is identical between them; only the
// edition differs, which is exactly the design.
import { template as sjabloonText } from 'sjabloon/text';
import { template as sjabloonHtml } from 'sjabloon/html';

const sjabloon = mode => (mode === 'raw' ? sjabloonText : sjabloonHtml);

const require = createRequire(import.meta.url);
const versions = {
	sjabloon: require('../../package.json').version,
	tempura: require('tempura/package.json').version,
	handlebars: require('handlebars/package.json').version,
	mustache: require('mustache/package.json').version,
};

const templates = {
	sjabloon: {
		raw: '<ul>{{#each list as item}}<li>User: {{ item.user }} / Web Site: {{ item.site }}</li>{{/each}}</ul>',
		escaped: '<ul>{{#each list as item}}<li>User: {{ item.user }} / Web Site: {{ item.site }}</li>{{/each}}</ul>',
	},
	tempura: {
		raw: '<ul>{{#expect list}}{{#each list as item}}<li>User: {{{ item.user }}} / Web Site: {{{ item.site }}}</li>{{/each}}</ul>',
		escaped: '<ul>{{#expect list}}{{#each list as item}}<li>User: {{ item.user }} / Web Site: {{ item.site }}</li>{{/each}}</ul>',
	},
	handlebars: {
		raw: '<ul>{{#each list}}<li>User: {{{user}}} / Web Site: {{{site}}}</li>{{/each}}</ul>',
		escaped: '<ul>{{#each list}}<li>User: {{user}} / Web Site: {{site}}</li>{{/each}}</ul>',
	},
	mustache: {
		raw: '<ul>{{#list}}<li>User: {{{user}}} / Web Site: {{{site}}}</li>{{/list}}</ul>',
		escaped: '<ul>{{#list}}<li>User: {{user}} / Web Site: {{site}}</li>{{/list}}</ul>',
	},
};

const engines = [
	{
		name: 'sjabloon',
		prepare: mode => sjabloon(mode)(templates.sjabloon[mode]),
		make: mode => sjabloon(mode)(templates.sjabloon[mode]),
		cold: (mode, data) => sjabloon(mode)(templates.sjabloon[mode])(data),
	},
	{
		name: 'tempura',
		prepare: mode => tempura(templates.tempura[mode]),
		make: mode => tempura(templates.tempura[mode]),
		cold: (mode, data) => tempura(templates.tempura[mode])(data),
	},
	{
		name: 'handlebars',
		prepare: mode => Handlebars.compile(templates.handlebars[mode]),
		make(mode) {
			const render = Handlebars.compile(templates.handlebars[mode]);
			render({ list: [] });
			return render;
		},
		cold: (mode, data) => Handlebars.compile(templates.handlebars[mode])(data),
	},
	{
		name: 'mustache',
		prepare(mode) {
			Mustache.clearCache();
			return Mustache.parse(templates.mustache[mode]);
		},
		make(mode) {
			const source = templates.mustache[mode];
			Mustache.clearCache();
			Mustache.parse(source);
			return data => Mustache.render(source, data);
		},
		cold(mode, data) {
			Mustache.clearCache();
			return Mustache.render(templates.mustache[mode], data);
		},
	},
];

let sink = 0;

function consume(value) {
	sink += typeof value === 'string' ? value.length : value ? 1 : 0;
}

function rows(n) {
	return Array.from({ length: n }, (_, i) => ({
		user: `user-${i} & "team"`,
		site: `site-${i} & "profile"`,
	}));
}

function escape(value) {
	return value.replace(/[&"]/g, char => char === '&' ? '&amp;' : '&quot;');
}

function expected(list, mode) {
	const value = mode === 'escaped' ? escape : String;
	return '<ul>' + list.map(item =>
		`<li>User: ${value(item.user)} / Web Site: ${value(item.site)}</li>`
	).join('') + '</ul>';
}

function batch(fn, n) {
	for (let i = 0; i < n; i++) consume(fn());
}

function calibrate(fn) {
	let n = 1;
	for (;;) {
		const start = performance.now();
		batch(fn, n);
		if (performance.now() - start >= 2 || n >= 1e6) return n;
		n *= 2;
	}
}

function sample(fn, n) {
	let ops = 0;
	const start = performance.now();
	let elapsed;
	do {
		batch(fn, n);
		ops += n;
		elapsed = performance.now() - start;
	} while (elapsed < 120);
	return ops / (elapsed / 1e3);
}

function median(values) {
	const sorted = values.slice().sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

function benchmark(title, items, relative = true) {
	const results = new Map(items.map(item => [item.name, []]));
	const sizes = new Map();

	for (const item of items) {
		const start = performance.now();
		while (performance.now() - start < 30) consume(item.fn());
		sizes.set(item.name, calibrate(item.fn));
	}

	for (let round = 0; round < 7; round++) {
		for (let i = 0; i < items.length; i++) {
			const item = items[(i + round) % items.length];
			results.get(item.name).push(sample(item.fn, sizes.get(item.name)));
		}
	}

	const baseline = median(results.get('sjabloon'));
	console.log('\n' + title);
	for (const item of items) {
		const values = results.get(item.name);
		const rate = median(values);
		const spread = (Math.max(...values) - Math.min(...values)) / rate * 100;
		const ratio = relative ? `  ${(rate / baseline).toFixed(2)}x sjabloon` : '';
		console.log(
			`  ${item.name.padEnd(12)} ${Math.round(rate).toLocaleString().padStart(14)} ops/sec` +
			`  ${spread.toFixed(1).padStart(5)}% range${ratio}`
		);
	}
}

for (const mode of ['raw', 'escaped']) {
	for (const size of [10, 1_000]) {
		const list = rows(size);
		const output = expected(list, mode);
		for (const engine of engines) {
			assert.equal(engine.make(mode)({ list }), output, `${engine.name}: ${mode}, ${size} rows`);
		}
	}
}

console.log(`Node ${process.version} · ${process.platform} ${process.arch}`);
console.log(engines.map(engine => `${engine.name} ${versions[engine.name]}`).join(' · '));
console.log('All renderers produced identical output.');

benchmark(
	'Native prepare, raw template (diagnostic; APIs are not equivalent)',
	engines.map(engine => ({ name: engine.name, fn: () => engine.prepare('raw') })),
	false
);

for (const mode of ['raw', 'escaped']) {
	const data = { list: rows(10) };
	benchmark(
		`Cold compile + render, ${mode}, 10 rows`,
		engines.map(engine => ({ name: engine.name, fn: () => engine.cold(mode, data) }))
	);
}

for (const mode of ['raw', 'escaped']) {
	for (const size of [10, 1_000]) {
		const data = { list: rows(size) };
		benchmark(
			`Hot render, ${mode}, ${size.toLocaleString()} rows`,
			engines.map(engine => {
				const render = engine.make(mode);
				return { name: engine.name, fn: () => render(data) };
			})
		);
	}
}

if (sink < 0) console.log(sink);
