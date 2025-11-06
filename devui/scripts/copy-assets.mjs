import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const src = resolve(__dirname, '../assets');
const destinations = [
  resolve(__dirname, '../build/assets'),
  resolve(__dirname, '../lib/assets'),
];

for (const dest of destinations) {
  try {
    await cp(src, dest, { recursive: true });
    console.log(`Copied assets to ${dest}`);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      console.warn('Assets directory missing, skipping copy to', dest);
    } else {
      console.error('Failed to copy assets to', dest, error);
      process.exitCode = 1;
    }
  }
}
