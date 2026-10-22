#!/usr/bin/env node
/**
 * 让任何 CLI Agent 向 Dog 秘书上报进度。
 *
 * 环境变量由 Dog 在启动 Agent 时自动注入：
 *   DOG_REPORT_URL / DOG_TOKEN / DOG_RUN_ID
 *
 * 用法：
 *   node scripts/agent-report.mjs --status running --progress 50 --message "资料找齐了"
 *   node scripts/agent-report.mjs --status waiting --message "需要你确认口吻" --attention
 *   node scripts/agent-report.mjs --status done --summary "成稿已放到 output.md"
 */

const args = process.argv.slice(2);
const opts = { status: 'running', progress: null, message: '', summary: '', attention: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--status') opts.status = args[++i];
  else if (a === '--progress') opts.progress = Number(args[++i]);
  else if (a === '--message') opts.message = args[++i];
  else if (a === '--summary') opts.summary = args[++i];
  else if (a === '--attention') opts.attention = true;
  else if (!opts.message) opts.message = a;
}

const url = process.env.DOG_REPORT_URL;
const token = process.env.DOG_TOKEN;
const runId = process.env.DOG_RUN_ID;
if (!url || !token || !runId) {
  console.error('缺少 DOG_REPORT_URL / DOG_TOKEN / DOG_RUN_ID；请在 Dog 的 CLI 智能体里运行。');
  process.exit(2);
}

const body = {
  runId,
  status: opts.status,
  message: opts.message || undefined,
  summary: opts.summary || undefined,
  progress: Number.isFinite(opts.progress) ? opts.progress : undefined,
  needsAttention: opts.attention || opts.status === 'waiting' || opts.status === 'blocked',
  attentionReason: opts.attention ? opts.message || '需要你确认' : undefined,
};

const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});
const text = await res.text();
if (!res.ok) {
  console.error('上报失败：', res.status, text);
  process.exit(1);
}
console.log(text);
