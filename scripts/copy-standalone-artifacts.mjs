#!/usr/bin/env node
import { mkdir, copyFile, access } from 'fs/promises';
import { constants } from 'fs';
import { resolve as resolvePath } from 'node:path';
import { homedir } from 'node:os';

const BUILD_DIR = resolvePath(process.cwd(), process.env.PORTALVR_BUILD_DIR ?? 'build');
const OPS_DIR = resolvePath(
  process.env.PORTALVR_OPS_DIR ?? resolvePath(homedir(), 'portal', 'ops'),
);

const REQUIRED_FILES = [
  {
    source: resolvePath(BUILD_DIR, 'context.html'),
    targetName: 'PortalVR-WebXR-Context.html',
  },
  {
    source: resolvePath(BUILD_DIR, 'portalvr-standalone.min.js'),
    targetName: 'PortalVR-WebXR.js',
  },
];

async function assertFileExists(path) {
  try {
    await access(path, constants.F_OK);
  } catch (error) {
    throw new Error(`Missing required build artifact: ${path}`);
  }
}

async function main() {
  await Promise.all(REQUIRED_FILES.map(({ source }) => assertFileExists(source)));
  await mkdir(OPS_DIR, { recursive: true });
  await Promise.all(
    REQUIRED_FILES.map(({ source, targetName }) =>
      copyFile(source, resolvePath(OPS_DIR, targetName)),
    ),
  );
  console.log(`Copied standalone artifacts to ${OPS_DIR}`);
}

await main();
