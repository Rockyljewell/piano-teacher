// Builds the self-contained mockup pages into docs/brand/playful/*.html
//   node docs/brand/playful/src/build.mjs            (all pages)
//   node docs/brand/playful/src/build.mjs home play  (some pages)
import { writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..');
const only = process.argv.slice(2);
const files = readdirSync(join(here, 'pages')).filter((f) => f.endsWith('.mjs'));
for (const f of files) {
  const name = f.replace(/\.mjs$/, '');
  if (only.length && !only.includes(name)) continue;
  const mod = await import(pathToFileURL(join(here, 'pages', f)).href + '?t=' + Date.now());
  const html = mod.default();
  writeFileSync(join(out, name + '.html'), html);
  console.log('built', name + '.html', (html.length / 1024).toFixed(0) + ' KB');
}
