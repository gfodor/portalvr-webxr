#!/usr/bin/env node
import { access, cp, mkdir, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EXT_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(EXT_ROOT, '..');
const RUNTIME_DIR = process.env.PORTALVR_RUNTIME_DIR ?? 'build';
const RUNTIME_BUILD_DIR = resolve(REPO_ROOT, RUNTIME_DIR);
const RUNTIME_WASM_DIR = resolve(RUNTIME_BUILD_DIR, 'wasm');
// Only ship the module build; the UMD/standalone bundles are for other targets.
const RUNTIME_FILES = ['portalvr.module.min.js'];
const RUNTIME_MODULE_FILE = resolve(RUNTIME_BUILD_DIR, RUNTIME_FILES[0]);

const EXT_BUILD_DIR = resolve(EXT_ROOT, 'build');
const EXT_RUNTIME_DIR = resolve(EXT_BUILD_DIR, 'runtime');
const EXT_WASM_DIR = resolve(EXT_BUILD_DIR, 'wasm');
const EXT_ASSETS_DIR = resolve(EXT_ROOT, 'assets');
const MEDIAPIPE_ASSETS_DIR = resolve(EXT_ASSETS_DIR, 'mediapipe');
const FONT_ASSETS_DIR = resolve(EXT_ASSETS_DIR, 'fonts');
const EXT_RUNTIME_MEDIAPIPE_DIR = resolve(EXT_RUNTIME_DIR, 'mediapipe');
const EXT_RUNTIME_FONTS_DIR = resolve(EXT_RUNTIME_DIR, 'fonts');

async function ensureFile(path, description) {
	try {
		await access(path, constants.R_OK);
	} catch (error) {
		const location = relative(EXT_ROOT, path);
		throw new Error(
			`[copy-runtime-assets] Missing ${description} at ${location}. Run \`npm run build\` in the repo root before building the extension.`,
		);
	}
}

async function ensureDirectory(path, description) {
	try {
		await access(path, constants.R_OK);
	} catch {
		const location = relative(EXT_ROOT, path);
		throw new Error(
			`[copy-runtime-assets] Missing ${description} at ${location}. Ensure assets are checked in before building the extension.`,
		);
	}
}

async function copyRuntime() {
	await Promise.all(
		RUNTIME_FILES.map((fileName) =>
			ensureFile(resolve(RUNTIME_BUILD_DIR, fileName), `PortalVR runtime bundle (${fileName})`),
		),
	);
	await ensureDirectory(MEDIAPIPE_ASSETS_DIR, 'MediaPipe assets directory');
	await ensureDirectory(FONT_ASSETS_DIR, 'font assets directory');

	await mkdir(EXT_BUILD_DIR, { recursive: true });
	await rm(EXT_RUNTIME_DIR, { recursive: true, force: true });
	await rm(EXT_WASM_DIR, { recursive: true, force: true });
	await rm(EXT_RUNTIME_MEDIAPIPE_DIR, { recursive: true, force: true });
	await rm(EXT_RUNTIME_FONTS_DIR, { recursive: true, force: true });
	await mkdir(EXT_RUNTIME_DIR, { recursive: true });

	for (const fileName of RUNTIME_FILES) {
		await cp(
			resolve(RUNTIME_BUILD_DIR, fileName),
			resolve(EXT_RUNTIME_DIR, fileName),
		);
	}
	await cp(RUNTIME_WASM_DIR, EXT_WASM_DIR, { recursive: true });
	await cp(MEDIAPIPE_ASSETS_DIR, EXT_RUNTIME_MEDIAPIPE_DIR, { recursive: true });
	await cp(FONT_ASSETS_DIR, EXT_RUNTIME_FONTS_DIR, { recursive: true });

	console.log(
		`[copy-runtime-assets] Copied minified runtime -> ${relative(
			EXT_ROOT,
			EXT_RUNTIME_DIR,
		)}, wasm assets -> ${relative(EXT_ROOT, EXT_WASM_DIR)}, MediaPipe assets -> ${relative(
			EXT_ROOT,
			EXT_RUNTIME_MEDIAPIPE_DIR,
		)}, fonts -> ${relative(EXT_ROOT, EXT_RUNTIME_FONTS_DIR)}`,
	);
}

copyRuntime().catch((error) => {
	console.error('[copy-runtime-assets] failed:', error.message);
	process.exitCode = 1;
});
