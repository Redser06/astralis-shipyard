import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Fails if anything that looks like a model API key — or the environment
 * variable that holds one — made it into the built client bundle.
 *
 * The architect endpoint keeps its key server-side by construction, but "by
 * construction" is a claim, and this is the check that makes it a fact. One
 * stray `import.meta.env.ANTHROPIC_API_KEY` would publish the key to every
 * visitor.
 */
const FORBIDDEN = [
  { pattern: /sk-ant-[A-Za-z0-9_-]{8,}/, label: 'an Anthropic API key' },
  { pattern: /ANTHROPIC_API_KEY\s*[:=]\s*["'][^"']+["']/, label: 'an inlined ANTHROPIC_API_KEY value' },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

let failed = false;
try {
  for (const file of walk('dist')) {
    if (!/\.(js|css|html|map)$/.test(file)) continue;
    const contents = readFileSync(file, 'utf8');
    for (const { pattern, label } of FORBIDDEN) {
      if (pattern.test(contents)) {
        console.error(`FAIL: ${file} appears to contain ${label}.`);
        failed = true;
      }
    }
  }
} catch (error) {
  console.error(`Could not scan dist/ — run "npm run build" first. (${error.message})`);
  process.exit(1);
}

if (failed) {
  console.error('\nA secret reached the client bundle. Do not deploy this build.');
  process.exit(1);
}
console.log('OK: no API keys found in the client bundle.');
