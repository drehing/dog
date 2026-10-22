'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function uid(prefix = '') {
  return (prefix ? prefix + '_' : '') + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

function nowIso() {
  return new Date().toISOString();
}

function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function truncate(text, len = 160) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return s.length > len ? s.slice(0, len - 1) + '…' : s;
}

function safeJson(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(file, text) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(file);
    } catch {}
    fs.renameSync(tmp, file);
  }
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function deepMerge(base, patch) {
  if (Array.isArray(patch)) return patch;
  if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
    const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
    for (const [k, v] of Object.entries(patch)) {
      out[k] = deepMerge(out[k], v);
    }
    return out;
  }
  return patch === undefined ? base : patch;
}

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function localDateKey(d = new Date()) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseClock(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, min };
}

function inQuietHours(settings, date = new Date()) {
  const q = settings?.notify?.quietHours;
  if (!q?.enabled) return false;
  const a = parseClock(q.start);
  const b = parseClock(q.end);
  if (!a || !b) return false;
  const cur = date.getHours() * 60 + date.getMinutes();
  const start = a.h * 60 + a.min;
  const end = b.h * 60 + b.min;
  if (start === end) return true;
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

function stateAt(date) {
  return inQuietHours({ notify: { quietHours: date } }) ? 'quiet' : 'normal';
}

/**
 * 相对时间的人话描述，用于通知与界面。
 */
function humanWhen(ms, now = Date.now()) {
  if (!ms) return '';
  const d = new Date(ms);
  const n = new Date(now);
  const diff = ms - now;
  const abs = Math.abs(diff);
  if (abs < 60 * 1000) return diff >= 0 ? '马上' : '刚刚';
  if (abs < 60 * 60 * 1000) {
    const m = Math.round(abs / 60000);
    return diff >= 0 ? `${m} 分钟后` : `${m} 分钟前`;
  }
  const sameDay = localDateKey(d) === localDateKey(n);
  const tmrw = new Date(n);
  tmrw.setDate(tmrw.getDate() + 1);
  const yest = new Date(n);
  yest.setDate(yest.getDate() - 1);
  const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (sameDay) return `今天 ${hm}`;
  if (localDateKey(d) === localDateKey(tmrw)) return `明天 ${hm}`;
  if (localDateKey(d) === localDateKey(yest)) return `昨天 ${hm}`;
  const days = Math.round((startOfDay(d) - startOfDay(n)) / 86400000);
  if (days > 1 && days < 7) {
    const wd = '日一二三四五六'[d.getDay()];
    return `周${wd} ${hm}`;
  }
  if (d.getFullYear() === n.getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

function shortId(id) {
  return String(id || '').slice(-6);
}

module.exports = {
  uid,
  nowIso,
  clamp,
  truncate,
  safeJson,
  ensureDir,
  atomicWrite,
  readJson,
  deepMerge,
  startOfDay,
  endOfDay,
  localDateKey,
  parseClock,
  inQuietHours,
  humanWhen,
  shortId,
};
