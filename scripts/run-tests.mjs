import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '.test-dist', 'supabase-storage.test.js');
mkdirSync(dirname(output), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: [resolve(root, 'tests', 'supabase-storage.test.ts')],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
});
execFileSync(process.execPath, ['--test', '--test-concurrency=1', output], { stdio: 'inherit', cwd: root });
