import { defineConfig } from 'tsdown'

export default defineConfig({
	entry: ['src/index.js', 'src/text.js', 'src/html.js'],
	platform: 'neutral',
	target: 'es2024',
	minify: true,
	sourcemap: false,
	dts: false,
	clean: true,
	hash: false,
})
