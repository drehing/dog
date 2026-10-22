#!/usr/bin/env node
/**
 * 启动 Electron，跑一遍界面冒烟测试并保存截图。
 *   npm run smoke
 *   npm run smoke:onboarding   # 全新数据目录，截引导页
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const electron = require('electron');
const onboarding = process.argv.includes('onboarding');
const dataDir = path.join(root, onboarding ? '.smoke-onboard' : '.smoke-data');
const shotDir = path.join(root, onboarding ? 'screenshots-onboard' : 'screenshots');

for (const dir of [dataDir, shotDir]) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

const env = { ...process.env, DOG_SMOKE: '1', DOG_DATA_DIR: dataDir, DOG_SMOKE_DIR: shotDir };
delete env.ELECTRON_RUN_AS_NODE;
if (onboarding) env.DOG_SMOKE_MODE = 'onboarding';

const child = spawn(electron, ['.', '--no-sandbox', '--disable-gpu'], {
  cwd: root,
  env,
  stdio: 'inherit',
});

child.on('exit', (code) => {
  const resultFile = path.join(shotDir, 'result.json');
  if (fs.existsSync(resultFile)) {
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    console.log(`\n冒烟测试${result.ok ? '通过' : '失败'}：${resultFile}`);
    if (!result.ok) console.log(result.errors);
    process.exit(result.ok ? 0 : 1);
  }
  console.error('没有生成冒烟测试结果，请检查上面的日志。');
  process.exit(code || 1);
});

child.on('error', (err) => {
  console.error('无法启动 Electron：', err.message);
  process.exit(1);
});
