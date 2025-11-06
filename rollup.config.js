import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import replace from '@rollup/plugin-replace';

const basePlugins = [
	replace({
		'process.env.NODE_ENV': JSON.stringify('production'),
		preventAssignment: true,
	}),
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
			file: 'build/portalvr.js',
			format: 'umd',
			name: 'PortalVR',
			inlineDynamicImports: true,
		},
		// Minified UMD build
		{
			file: 'build/portalvr.min.js',
			format: 'umd',
			name: 'PortalVR',
			inlineDynamicImports: true,
			plugins: [terser()],
		},
		// ES module build
		{
			file: 'build/portalvr.module.js',
			format: 'es',
		},
		// Minified ES module build
		{
			file: 'build/portalvr.module.min.js',
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
			file: 'build/portalvr-standalone.js',
			format: 'iife',
			name: 'PortalVRStandalone',
			inlineDynamicImports: true,
		},
		{
			file: 'build/portalvr-standalone.min.js',
			format: 'iife',
			name: 'PortalVRStandalone',
			inlineDynamicImports: true,
			plugins: [terser()],
		},
	],
};

export default [libraryConfig, standaloneConfig];
