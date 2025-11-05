import commonjs from '@rollup/plugin-commonjs';
import peerDepsExternal from 'rollup-plugin-peer-deps-external';
import replace from '@rollup/plugin-replace';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

const globals = {
	portalvr: 'PortalVR', // Global variable exposed by the PortalVR runtime bundle
};

export default {
	input: 'lib/index.js',
	external: ['portalvr'],
	plugins: [
		peerDepsExternal(),
		resolve(),
		commonjs(),
		replace({
			'process.env.NODE_ENV': JSON.stringify('production'),
			preventAssignment: true,
		}),
	],
	output: [
		// UMD build
		{
			file: 'build/portalvr-devui.js',
			format: 'umd',
			name: 'PortalVR_DevUI',
			globals,
		},
		// Minified UMD build
		{
			file: 'build/portalvr-devui.min.js',
			format: 'umd',
			name: 'PortalVR_DevUI',
			globals,
			plugins: [terser()],
		},
		// ES module build
		{
			file: 'build/portalvr-devui.module.js',
			format: 'es',
			globals,
		},
		// Minified ES module build
		{
			file: 'build/portalvr-devui.module.min.js',
			format: 'es',
			globals,
			plugins: [terser()],
		},
	],
};
