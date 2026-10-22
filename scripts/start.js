#!/usr/bin/env node
/**
 * 启动开发版。
 * - 清掉 ELECTRON_RUN_AS_NODE，避免 Electron 被当成 Node 执行；
 * - 在受限宿主 / Windows 预览版里自动加 --no-sandbox（可用 --compat 强制）。
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const inputArgs = process.argv.slice(2);
const compat =
  inputArgs.includes('--compat') ||
  process.env.DOG_NO_SANDBOX === '1' ||
  process.env.DSH_SHELL === '1';
const args = ['.', ...inputArgs.filter((a) => a !== '--compat')];
if (compat && !args.includes('--no-sandbox')) args.push('--no-sandbox');

const root = path.join(__dirname, '..');
if (compat && !env.DOG_DATA_DIR) {
  env.DOG_DATA_DIR = path.join(root, 'data');
}
console.log(`[Dog] 源码启动 · ${compat ? '兼容模式（--no-sandbox）' : '普通模式'}${env.DOG_DATA_DIR ? ` · 数据目录 ${env.DOG_DATA_DIR}` : ''}`);
const child = spawn(electron, args, {
  cwd: root,
  env,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code || 0));
child.on('error', (err) => {
  console.error('无法启动 Electron：', err.message);
  process.exit(1);
});
