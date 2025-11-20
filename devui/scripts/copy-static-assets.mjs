import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src/assets');
const DEST = resolve(process.cwd(), 'lib/assets');

async function main() {
  await mkdir(DEST, { recursive: true });
  await cp(SRC, DEST, { recursive: true });
  console.log(`[copy-static-assets] copied assets -> ${DEST}`);
}

main().catch((err) => {
  console.error('[copy-static-assets] failed', err);
  process.exitCode = 1;
});
