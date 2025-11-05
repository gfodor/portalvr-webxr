import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

const basePlugins = [
	resolve({
		browser: true,
		preferBuiltins: false,
	}),
	commonjs(),
];

const libraryConfig = {
	input: 'lib/index.js',
	external: ['@mediapipe/tasks-vision'],
	plugins: basePlugins,
	output: [
		// UMD build
		{
			file: 'build/iwer.js',
			format: 'umd',
			name: 'IWER',
			inlineDynamicImports: true,
		},
		// Minified UMD build
		{
			file: 'build/iwer.min.js',
			format: 'umd',
			name: 'IWER',
			inlineDynamicImports: true,
			plugins: [terser()],
		},
		// ES module build
		{
			file: 'build/iwer.module.js',
			format: 'es',
		},
		// Minified ES module build
		{
			file: 'build/iwer.module.min.js',
			format: 'es',
			plugins: [terser()],
		},
	],
};

const standaloneConfig = {
	input: 'lib/standalone.js',
	plugins: basePlugins,
	output: [
		{
			file: 'build/iwer-standalone.js',
			format: 'iife',
			name: 'IWERStandalone',
			inlineDynamicImports: true,
		},
		{
			file: 'build/iwer-standalone.min.js',
			format: 'iife',
			name: 'IWERStandalone',
			inlineDynamicImports: true,
			plugins: [terser()],
		},
	],
};

export default [libraryConfig, standaloneConfig];
