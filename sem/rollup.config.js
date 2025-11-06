import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import peerDepsExternal from 'rollup-plugin-peer-deps-external';
import replace from '@rollup/plugin-replace';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

const globals = {
	portalvr: 'PortalVR',
	three: 'THREE',
};

const externalModules = ['portalvr', 'three'];

const basePlugins = [peerDepsExternal(), resolve(), commonjs(), json()];

const esPlugins = [
	...basePlugins,
	replace({
		__IS_UMD__: 'false', // Set to false for ES builds
		preventAssignment: true,
	}),
];

const umdPlugins = [
	...basePlugins,
	replace({
		__IS_UMD__: 'true', // Set to true for UMD builds
		preventAssignment: true,
	}),
];

export default [
	// UMD builds
	{
		input: 'lib/index.js',
		external: externalModules,
		plugins: umdPlugins,
		output: [
			{
				file: 'build/portalvr-sem.js',
				format: 'umd',
				name: 'PortalVR_SEM',
				globals,
			},
			{
				file: 'build/portalvr-sem.min.js',
				format: 'umd',
				name: 'PortalVR_SEM',
				globals,
				plugins: [terser()],
			},
		],
	},
	// ES module builds
	{
		input: 'lib/index.js',
		external: externalModules,
		plugins: esPlugins,
		output: [
			{
				dir: 'build/es',
				format: 'es',
				entryFileNames: '[name].js',
				chunkFileNames: '[name]-[hash].js',
				globals,
			},
			{
				dir: 'build/es-min',
				format: 'es',
				entryFileNames: '[name].min.js',
				chunkFileNames: '[name]-[hash].min.js',
				plugins: [terser()],
				globals,
			},
		],
	},
];
