#!/usr/bin/env node
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

const BUILD_DIR = resolve('build');
const SCRIPT_PATH = resolve(BUILD_DIR, 'portalvr-context.min.js');
const HTML_PATH = resolve(BUILD_DIR, 'context.html');

async function main() {
  const scriptSource = await readFile(SCRIPT_PATH, 'utf8');
  const escapedScript = scriptSource.replace(/<\/script/gi, '</scr"+"ipt');
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PortalVR Runtime Context</title>
</head>
<body>
  <noscript>PortalVR requires JavaScript to persist configuration.</noscript>
  <script>
${escapedScript}
  </script>
</body>
</html>
`;
  await writeFile(HTML_PATH, html, 'utf8');
  console.log(`[generate-context-html] wrote ${HTML_PATH}`);
}

main().catch((error) => {
  console.error('[generate-context-html] failed:', error);
  process.exitCode = 1;
});
