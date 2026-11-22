'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const esbuild = require(process.env.NCM_ESBUILD_PATH || 'esbuild');

const root = __dirname;
const manifest = path.join(root, 'manifest.json');
const outputDirectory = path.join(root, 'dist');
const { version } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
const output = path.join(outputDirectory, 'ncm-listen-together-' + version + '.plugin');

const { outputFiles } = esbuild.buildSync({
  absWorkingDir: root,
  entryPoints: ['src/main.js'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome91',
  write: false,
});
fs.mkdirSync(outputDirectory, { recursive: true });

const createArchive = [
  'from pathlib import Path',
  'import sys, zipfile',
  'with zipfile.ZipFile(sys.argv[1], "w", compression=zipfile.ZIP_DEFLATED) as packed:',
  '    packed.writestr("manifest.json", Path(sys.argv[2]).read_bytes())',
  '    packed.writestr("main.js", sys.stdin.buffer.read())',
].join('\n');
const result = spawnSync(process.env.NCM_BUILD_PYTHON || 'python',
  ['-c', createArchive, output, manifest], { input: outputFiles[0].contents });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stderr.toString());
console.log(output);
