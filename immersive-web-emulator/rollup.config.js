import alias from '@rollup/plugin-alias';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';
import nodeResolve from '@rollup/plugin-node-resolve';
import strip from '@rollup/plugin-strip';
import terser from '@rollup/plugin-terser';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const shouldStripConsole = !process.env.IWE_SKIP_CONSOLE_STRIP;
const stripConsolePlugin = shouldStripConsole
	? strip({
			functions: ['console.*'],
		})
	: null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolvePath(__dirname, '..');
const RUNTIME_DIR = process.env.PORTALVR_RUNTIME_DIR ?? 'build';
const RUNTIME_MODULE_PATH = resolvePath(ROOT_DIR, RUNTIME_DIR, 'portalvr.module.min.js');
const DEVUI_LIB_DIR = resolvePath(ROOT_DIR, 'devui', 'lib');
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
				find: /^portalvr\/wasm\/portal-pose\/portal_pose_embed\.js$/,
				replacement: PORTAL_POSE_EMBED_PATH,
			},
			{ find: /^portalvr$/, replacement: RUNTIME_MODULE_PATH },
			{ find: '@portalvr/devui', replacement: DEVUI_LIB_DIR },
		],
	});

const externalModules = ['three'];

export default [
	{
		input: 'lib/content-loader.js',
		external: externalModules,
		plugins: [createRuntimeAlias(), nodeResolve(), commonjs()],
		output: {
			file: 'build/content-loader.js',
			format: 'iife',
		},
	},
	{
		input: 'lib/index.js',
		external: externalModules,
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
			...(stripConsolePlugin ? [stripConsolePlugin] : []),
		],
		output: {
			file: 'build/iwe.min.js',
			format: 'umd',
			name: 'PORTAL',
			inlineDynamicImports: true,
			plugins: [terser()],
			footer: 'PORTAL.injectRuntime();',
			globals: { three: 'THREE' },
		},
	},
	{
		input: 'lib/identity-bootstrap.js',
		external: externalModules,
		plugins: [createRuntimeAlias(), nodeResolve(), commonjs()],
		output: {
			file: 'build/identity-bootstrap.js',
			format: 'iife',
			inlineDynamicImports: true,
		},
	},
	{
		input: 'lib/pointer-lock-guard.js',
		external: externalModules,
		plugins: [nodeResolve(), commonjs()],
		output: {
			file: 'build/pointer-lock-guard.js',
			format: 'iife',
			inlineDynamicImports: true,
		},
	},
	{
		input: 'lib/service-worker.js',
		external: externalModules,
		plugins: [createRuntimeAlias(), nodeResolve(), commonjs()],
		output: {
			file: 'build/service-worker.min.js',
			format: 'esm',
			plugins: [terser()],
		},
	},
];
