#!/usr/bin/env node
import { access, cp, mkdir, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EXT_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(EXT_ROOT, '..');
const RUNTIME_BUILD_DIR = resolve(REPO_ROOT, 'build');
const RUNTIME_WASM_DIR = resolve(RUNTIME_BUILD_DIR, 'wasm');
const RUNTIME_MODULE_FILE = resolve(RUNTIME_BUILD_DIR, 'portalvr.module.js');

const EXT_BUILD_DIR = resolve(EXT_ROOT, 'build');
const EXT_RUNTIME_DIR = resolve(EXT_BUILD_DIR, 'runtime');
const EXT_WASM_DIR = resolve(EXT_BUILD_DIR, 'wasm');

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

async function copyRuntime() {
	await ensureFile(RUNTIME_MODULE_FILE, 'PortalVR runtime bundle');

	await mkdir(EXT_BUILD_DIR, { recursive: true });
	await rm(EXT_RUNTIME_DIR, { recursive: true, force: true });
	await rm(EXT_WASM_DIR, { recursive: true, force: true });

	await cp(RUNTIME_BUILD_DIR, EXT_RUNTIME_DIR, { recursive: true });
	await cp(RUNTIME_WASM_DIR, EXT_WASM_DIR, { recursive: true });

	console.log(
		`[copy-runtime-assets] Copied runtime build -> ${relative(
			EXT_ROOT,
			EXT_RUNTIME_DIR,
		)} and wasm assets -> ${relative(EXT_ROOT, EXT_WASM_DIR)}`,
	);
}

copyRuntime().catch((error) => {
	console.error('[copy-runtime-assets] failed:', error.message);
	process.exitCode = 1;
});
