#!/usr/bin/env node
// Detects mojibake: text that was UTF-8 but got read/written as Latin-1/Windows-1252,
// turning accented characters into garbled multi-character sequences.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SELF = path.resolve(__filename);
// .cache: modelos de transcrição baixados em runtime (ex: tokenizer.json do
// Whisper) têm vocabulário multilíngue cheio de sequências tipo "Ã©"/"Ã¼" que
// são BPE de verdade, não mojibake — davam milhares de falso-positivo aqui.
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache']);
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.sql', '.css']);

// "Ã"/"Â" followed by a Latin-1 supplement / C1 control character is the signature
// of a UTF-8 continuation byte that got reinterpreted as its own character.
const MOJIBAKE_PATTERN = /[ÃÂ][-¿]/;

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

const files = walk(ROOT, []);
const problems = [];

for (const file of files) {
  if (path.resolve(file) === SELF) continue;
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    if (MOJIBAKE_PATTERN.test(line)) {
      problems.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
    }
  });
}

if (problems.length > 0) {
  console.error('Possível mojibake (encoding corrompido) encontrado:\n');
  problems.forEach(p => console.error('  ' + p));
  console.error(`\n${problems.length} ocorrência(s). Salve os arquivos como UTF-8 e corrija os trechos acima.`);
  process.exit(1);
}

console.log('Nenhum problema de encoding encontrado.');
