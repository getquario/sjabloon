import { globSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { render, template } from '../src/html.js';

const notOk = (value, message) => assert.ok(!value, message);

test('xprsn prototype guards apply inside templates', () => {
	assert.throws(() => render('{{ a.constructor }}', { a: {} }), TypeError);
	assert.throws(() => render('{{#if a["__proto__"]}}x{{/if}}', { a: {} }), TypeError);
});

test('each scope objects do not leak writes to values', () => {
	const values = { items: [1], name: 'outer' };
	render('{{#each items as name}}{{ name }}{{/each}}', values);
	assert.strictEqual(values.name, 'outer', 'loop variable shadowed, parent untouched');
});

test('each rejects unsafe binding names', () => {
	for (const name of ['__proto__', 'constructor', 'prototype']) {
		assert.throws(() => template(`{{#each items as ${name}}}x{{/each}}`), SyntaxError, `item ${name}`);
		assert.throws(() => template(`{{#each items as item, ${name}}}x{{/each}}`), SyntaxError, `index ${name}`);
	}
});

// Glob src/ rather than naming one file: a scan pinned to a single path keeps
// passing after a module moves, silently covering nothing. The length check is
// the other half — a glob that matches nothing must fail, not pass quietly.
test('source contains no string-to-code constructs', () => {
	const files = globSync('src/**/*.js');
	assert.ok(files.length, 'the glob found the sources');
	for (const file of files) {
		notOk(/\beval\b|\bFunction\s*\(|new\s+Function/.test(readFileSync(file, 'utf8')), file);
	}
});

test('tokenizer resists ReDoS-shaped input', () => {
	const n = 50_000;
	const t0 = Date.now();

	// Open braces + long runs of spaces (no closer) must stay linear.
	assert.strictEqual(template('{{' + ' '.repeat(n))({}), '{{' + ' '.repeat(n));
	assert.strictEqual(template('{{{' + ' '.repeat(n))({}), '{{{' + ' '.repeat(n));

	// CodeQL shape: repeated open-brace prefixes without closers.
	assert.strictEqual(template('{{{{a'.repeat(n))({}), '{{{{a'.repeat(n));
	assert.strictEqual(template('{{{{{{a'.repeat(n))({}), '{{{{{{a'.repeat(n));

	// Many {{{...}} segments (no }}}) must not rescan to EOF each time.
	try { template(('{{{z}}').repeat(20_000)); } catch { /* compile fails on `{z` */ }

	// Real tag with heavy inner whitespace still tokenizes.
	assert.strictEqual(template('{{' + ' '.repeat(n) + 'x' + ' '.repeat(n) + '}}')({ x: 1 }), '1');

	// Adjacent whitespace + trim dashes must stay linear.
	assert.strictEqual(template(' '.repeat(n) + '{{- "x" -}}' + ' '.repeat(n))({}), 'x');

	// Unclosed raw falls back to {{ ... }} (extra `{` enters the expr).
	assert.throws(() => template('{{{1}}'), SyntaxError);

	assert.ok(Date.now() - t0 < 500, 'completes quickly');
});

test('xprsn tokenizer stays linear through template tags', () => {
	const n = 30_000;
	const t0 = Date.now();
	for (const q of ['"', "'"]) {
		const expr = q + ('\\' + q).repeat(n);
		assert.throws(() => template('{{ ' + expr + ' }}'), SyntaxError, q + ' quote input is rejected');
	}
	assert.ok(Date.now() - t0 < 1500, 'completes without quadratic rescanning');
});
