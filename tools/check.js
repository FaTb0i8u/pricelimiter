/**
 * Static checks that need no dependencies:
 *
 *   - every JavaScript file parses;
 *   - every file manifest.json points at exists;
 *   - every content script's PPP dependencies load before it.
 *
 * The last one matters because there is no bundler: a module that reads
 * `PPP.price` at load time, injected before parse-price.js, fails only in the
 * browser, only on first use, and only as "cannot read properties of
 * undefined".
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const problems = [];

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

for (const file of walk(root, [])) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    problems.push(`syntax: ${path.relative(root, file)}\n${error.stderr}`);
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const referenced = [
  manifest.background && manifest.background.service_worker,
  manifest.options_ui && manifest.options_ui.page,
  ...Object.values(manifest.icons || {}),
  ...Object.values((manifest.action && manifest.action.default_icon) || {}),
  ...(manifest.content_scripts || []).flatMap((cs) => [...(cs.js || []), ...(cs.css || [])])
].filter(Boolean);
for (const file of referenced) {
  if (!fs.existsSync(path.join(root, file))) problems.push(`manifest: missing ${file}`);
}

/** Which PPP namespace each module defines, e.g. `PPP.price = {`. */
const NAMESPACE_RE = /\bPPP\.(\w+)\s*=\s*\{/;
/** Every namespace a module touches, e.g. `PPP.price.SYMBOL_CHARS`. */
const REFERENCE_RE = /\bPPP\.([a-z]\w*)/g;

for (const cs of manifest.content_scripts || []) {
  const defined = new Set();
  for (const file of cs.js || []) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    const source = fs.readFileSync(full, 'utf8');
    const own = (NAMESPACE_RE.exec(source) || [])[1];
    const missing = new Set();
    for (const m of source.matchAll(REFERENCE_RE)) {
      if (m[1] !== own && !defined.has(m[1])) missing.add(m[1]);
    }
    for (const name of missing) {
      problems.push(`order: ${file} uses PPP.${name}, which no earlier content script defines`);
    }
    // tools/build-fixture.js inlines these files into one <script> element,
    // which a literal closing tag anywhere in the source would end early.
    if (/<\/script/i.test(source)) {
      problems.push(`inline: ${file} contains a literal </script>; split it, as in '</' + 'script>'`);
    }
    if (own) defined.add(own);
  }
}

if (problems.length) {
  process.stderr.write(problems.join('\n') + '\n');
  process.exit(1);
}
process.stdout.write(`ok: ${referenced.length} manifest paths, load order verified\n`);
