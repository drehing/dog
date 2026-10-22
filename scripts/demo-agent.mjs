#!/usr/bin/env node
/**
 * 一个假装的 CLI Agent，用来验证 Dog 的“命令行智能体”接入。
 * 配置方式（Windows）：
 *   命令： node
 *   参数： "<绝对路径>\scripts\demo-agent.mjs" {prompt}
 *   传参方式：参数
 */

const prompt = process.env.DOG_PROMPT || process.argv.slice(2).join(' ') || '未命名任务';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function report(status, progress, message, extra = {}) {
  console.log('DOG_REPORT ' + JSON.stringify({ status, progress, message, ...extra }));
}

async function main() {
  console.log(`# 收到任务：${prompt}`);
  report('running', 10, '拆解任务中');
  await sleep(900);
  report('running', 45, '已完成资料整理');
  await sleep(900);
  report('running', 80, '正在整理成稿');
  await sleep(700);
  console.log('');
  console.log('（演示 Agent 产物）');
  console.log(`任务：${prompt}`);
  console.log('结论：这一步已经跑通了 CLI 接管、进度上报和完成通知。');
  console.log('下一步建议：把命令换成你真实的 Agent 即可。');
  report('done', 100, '任务完成', { summary: `已完成：${prompt}\n结论：CLI 接管链路正常。` });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
