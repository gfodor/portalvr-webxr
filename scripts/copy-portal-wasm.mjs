#!/usr/bin/env node
import { mkdir, copyFile, stat } from 'fs/promises';
import { resolve } from 'path';

const PORTALVR_BUILD_DIR = process.env.PORTALVR_BUILD_DIR ?? 'build';

const SOURCE_DIR = resolve('src', 'wasm', 'portal-pose');
const TARGET_DIRS = [
	resolve('lib', 'wasm', 'portal-pose'),
	resolve(PORTALVR_BUILD_DIR, 'wasm', 'portal-pose'),
];
const FILES = ['portal_pose.js', 'portal_pose.wasm'];

async function directoryExists(path) {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

async function copyAssets() {
  const srcExists = await directoryExists(SOURCE_DIR);
  if (!srcExists) {
    console.warn(`[copy-portal-wasm] source directory missing: ${SOURCE_DIR}`);
    return;
  }

  for (const target of TARGET_DIRS) {
    await mkdir(target, { recursive: true });
    for (const file of FILES) {
      const from = resolve(SOURCE_DIR, file);
      const to = resolve(target, file);
      await copyFile(from, to);
      console.log(`[copy-portal-wasm] copied ${file} -> ${to}`);
    }
  }
}

copyAssets().catch((err) => {
  console.error('[copy-portal-wasm] failed:', err);
  process.exitCode = 1;
});
