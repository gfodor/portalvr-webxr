#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { access, mkdir, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const EXT_DIR = resolve(ROOT_DIR, 'immersive-web-emulator');
const OUTPUT_DIR = resolve(ROOT_DIR, 'dist');
const OUTPUT_NAME = 'portalvr-webxr-extension.zip';
const OUTPUT_PATH = resolve(OUTPUT_DIR, OUTPUT_NAME);

const REQUIRED_PATHS = [
	{ path: resolve(EXT_DIR, 'manifest.json'), description: 'manifest.json' },
	{ path: resolve(EXT_DIR, 'build'), description: 'extension build output (run npm run build:emulator first)' },
	{ path: resolve(EXT_DIR, 'icons'), description: 'icons directory' },
];

async function ensureExists(target) {
	try {
		await access(target.path, constants.R_OK);
	} catch {
		const location = relative(ROOT_DIR, target.path);
		throw new Error(`[package-extension] Missing ${target.description} at ${location}`);
	}
}

async function createZip() {
	await mkdir(OUTPUT_DIR, { recursive: true });
	await rm(OUTPUT_PATH, { force: true });

	const zipArgs = ['-r', OUTPUT_PATH, 'manifest.json', 'build', 'icons'];
	const zipResult = spawnSync('zip', zipArgs, {
		cwd: EXT_DIR,
		stdio: 'inherit',
	});
	if (zipResult.status !== 0) {
		throw new Error('[package-extension] zip command failed');
	}
	const relativePath = relative(ROOT_DIR, OUTPUT_PATH);
	console.log(`[package-extension] Created ${relativePath}`);
}

async function main() {
	await Promise.all(REQUIRED_PATHS.map(ensureExists));
	await createZip();
}

main().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
