import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import replace from '@rollup/plugin-replace';
import { join as joinPath } from 'node:path';

const contextBridgeDisabledValues = ['1', 'true', 'yes'];
const isContextBridgeDisabled = contextBridgeDisabledValues.includes(
  String(process.env.PORTALVR_DISABLE_CONTEXT_BRIDGE ?? '').toLowerCase(),
);

const BUILD_DIR = process.env.PORTALVR_BUILD_DIR ?? 'build';
const toOutputPath = (filename) => joinPath(BUILD_DIR, filename);

const replaceValues = {
  'process.env.NODE_ENV': JSON.stringify('production'),
};

if (isContextBridgeDisabled) {
  replaceValues.__PORTALVR_CONTEXT_BRIDGE__ = 'disabled';
}

const basePlugins = [
	replace({
		...replaceValues,
		preventAssignment: true,
	}),
	resolve({
		browser: true,
		preferBuiltins: false,
	}),
	commonjs(),
];

const contextHtmlPlugin = () => {
	let emitted = false;
	return {
		name: 'portalvr-context-html',
		generateBundle(options, bundle) {
			if (emitted || !options.file.endsWith('context.js')) {
				return;
			}

			const contextChunk = Object.values(bundle).find(
				(output) => output.type === 'chunk' && typeof output.code === 'string'
			);

			if (!contextChunk) {
				this.error('Unable to inline PortalVR context chunk.');
			}

			const script = contextChunk.code.replace(/^/gm, '    ');
			const html = [
				'<!doctype html>',
				'<html lang="en">',
				'<head>',
				'  <meta charset="utf-8" />',
				'  <meta name="viewport" content="width=device-width, initial-scale=1" />',
				'  <title>PortalVR Context</title>',
				'  <meta name="robots" content="noindex,nofollow" />',
				'  <style>html,body{background:transparent;margin:0;padding:0;}</style>',
				'</head>',
				'<body>',
				'  <script>',
				script,
				'  </script>',
				'</body>',
				'</html>',
			].join('\n');

			this.emitFile({
				type: 'asset',
				fileName: 'context.html',
				source: html,
			});

			emitted = true;
		},
	};
};

const libraryConfig = {
	input: 'lib/index.js',
	external: ['@mediapipe/tasks-vision'],
	plugins: basePlugins,
	output: [
		// UMD build
		{
			file: toOutputPath('portalvr.js'),
			format: 'umd',
			name: 'PortalVR',
			inlineDynamicImports: true,
		},
		// Minified UMD build
		{
			file: toOutputPath('portalvr.min.js'),
			format: 'umd',
			name: 'PortalVR',
			inlineDynamicImports: true,
			plugins: [terser()],
		},
		// ES module build
		{
			file: toOutputPath('portalvr.module.js'),
			format: 'es',
		},
		// Minified ES module build
		{
			file: toOutputPath('portalvr.module.min.js'),
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
			file: toOutputPath('portalvr-standalone.js'),
			format: 'iife',
			name: 'PortalVRStandalone',
			inlineDynamicImports: true,
			intro: 'globalThis.__PORTALVR_FORCE_EMBEDDED_ASSETS__ = true;',
		},
		{
			file: toOutputPath('portalvr-standalone.min.js'),
			format: 'iife',
			name: 'PortalVRStandalone',
			inlineDynamicImports: true,
			intro: 'globalThis.__PORTALVR_FORCE_EMBEDDED_ASSETS__ = true;',
			plugins: [terser()],
		},
	],
};

const contextConfig = {
	input: 'lib/context/iframe.js',
	plugins: [...basePlugins, contextHtmlPlugin()],
	output: [
		{
			file: toOutputPath('context.js'),
			format: 'iife',
			name: 'PortalVRContext',
			inlineDynamicImports: true,
		},
		{
			file: toOutputPath('context.min.js'),
			format: 'iife',
			name: 'PortalVRContext',
			inlineDynamicImports: true,
			plugins: [terser()],
		},
	],
};

export default [libraryConfig, standaloneConfig, contextConfig];
