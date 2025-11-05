import alias from '@rollup/plugin-alias';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';
import nodeResolve from '@rollup/plugin-node-resolve';
import strip from '@rollup/plugin-strip';
import terser from '@rollup/plugin-terser';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolvePath(__dirname, '..');
const RUNTIME_MODULE_PATH = resolvePath(ROOT_DIR, 'build', 'portalvr.module.js');
const DEVUI_LIB_DIR = resolvePath(ROOT_DIR, 'devui', 'lib');
const SEM_LIB_DIR = resolvePath(ROOT_DIR, 'sem', 'lib');
const PORTAL_POSE_EMBED_PATH = resolvePath(
	ROOT_DIR,
	'lib',
	'wasm',
	'portal-pose',
	'portal_pose_embed.js',
);

const createRuntimeAlias = () =>
	alias({
		entries: [
			{
				find: 'portalvr/wasm/portal-pose/portal_pose_embed.js',
				replacement: PORTAL_POSE_EMBED_PATH,
			},
			{ find: 'portalvr', replacement: RUNTIME_MODULE_PATH },
			{ find: '@portalvr/devui', replacement: DEVUI_LIB_DIR },
			{ find: '@portalvr/sem', replacement: SEM_LIB_DIR },
		],
	});

export default [
	{
		input: 'lib/index.js',
		plugins: [
			createRuntimeAlias(),
			nodeResolve(),
			commonjs(),
			json(),
			replace({
				'process.env.NODE_ENV': JSON.stringify('production'),
				preventAssignment: true,
			}),
			replace({
				__IS_UMD__: 'true', // Set to true for UMD builds
				preventAssignment: true,
			}),
			strip({
				functions: ['console.*'],
			}),
		],
		output: {
			file: 'build/iwe.min.js',
			format: 'umd',
			name: 'IWE',
			inlineDynamicImports: true,
			plugins: [terser()],
			footer: 'IWE.injectRuntime();',
		},
	},
	{
		input: 'lib/service-worker.js',
		plugins: [createRuntimeAlias(), nodeResolve(), commonjs()],
		output: {
			file: 'build/service-worker.min.js',
			format: 'esm',
			plugins: [terser()],
		},
	},
];
