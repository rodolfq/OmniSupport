const path = require('path');
const { spawn } = require('child_process');
const { loadTestEnv } = require('./env-test');

loadTestEnv();

const projectRoot = path.join(__dirname, '..');
const nextBin = path.join(projectRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const port = process.env.PORT || '3100';

// Spawn direto do bin do Next com argv (sem shell) — evita a diferença de
// sintaxe `VAR=valor comando` (Unix) vs Windows que quebraria isso num script
// do package.json. Os env vars já foram injetados em process.env acima, antes
// do spawn, e são herdados pelo filho via `env: process.env`.
const child = spawn(process.execPath, [nextBin, 'dev', '-p', port], {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
