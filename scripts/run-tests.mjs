import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const names = ['supabase-storage.test', 'local-test.test'];
const outputs = [];
for (const name of names) {
  const output = resolve(root, '.test-dist', name + '.js');
  mkdirSync(dirname(output), { recursive: true });
  await build({
    absWorkingDir: root,
    entryPoints: [resolve(root, 'tests', name + '.ts')],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
  });
  outputs.push(output);
}
execFileSync(process.execPath, ['--test', '--test-concurrency=1', ...outputs], { stdio: 'inherit', cwd: root });
