import { defineConfig } from 'tsdown'

export default defineConfig({
	entry: ['src/index.js', 'src/text.js', 'src/html.js'],
	platform: 'neutral',
	target: 'es2024',
	minify: true,
	sourcemap: false,
	// The `.d.ts` are hand-written so the shared surface stays shared across the
	// three editions; `tsc` checks them against `src/` instead of emitting them.
	// They live beside the code they describe and are copied into `dist/` here,
	// so `src/` never has to ship.
	dts: false,
	copy: ['src/*.d.ts'],
	clean: true,
	hash: false,
})
