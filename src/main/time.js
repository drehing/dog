'use strict';

/**
 * 中文自然语言时间解析。只处理秘书场景常见说法，宁可少解析，不乱解析。
 * 返回 { at, title, hasDate, hasTime }，at 为本地时区毫秒时间戳。
 */

const PERIOD_DEFAULT = {
  凌晨: 5,
  早上: 8,
  上午: 9,
  中午: 12,
  下午: 14,
  傍晚: 18,
  晚上: 20,
  夜里: 22,
};

const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function cnToNum(s) {
  if (s == null) return null;
  if (/^\d+$/.test(s)) return Number(s);
  if (!s) return null;
  if (s.includes('十')) {
    const [a, b] = s.split('十');
    return (a ? CN_DIGIT[a] ?? 0 : 1) * 10 + (b ? CN_DIGIT[b] ?? 0 : 0);
  }
  return CN_DIGIT[s] ?? null;
}

function weekdayIndex(ch) {
  if (!ch) return null;
  if (ch === '日' || ch === '天') return 0;
  return '一二三四五六'.indexOf(ch) + 1 || null;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function overlaps(spans, start, end) {
  return spans.some(([a, b]) => start < b && end > a);
}

function applyPeriod(h, period) {
  if (!period) return h;
  if (['下午', '傍晚', '晚上', '夜里'].includes(period) && h < 12) return h + 12;
  if (period === '中午' && h < 11) return h + 12;
  if (period === '凌晨' && h === 12) return 0;
  if (['早上', '上午'].includes(period) && h === 12) return 0;
  return h;
}

function parseWhen(raw, nowInput = new Date()) {
  const now = new Date(nowInput);
  const original = String(raw || '').trim();
  if (!original) return { at: null, title: '', hasDate: false, hasTime: false };

  let text = original;
  const spans = [];
  let dateExplicit = false;
  let dayOffset = null; // 相对今天的天数
  let baseDate = startOfDay(now);
  let periodFromDate = null;
  let hasTime = false;
  let hour = null;
  let minute = 0;

  // 1) 相对时间：半小时后 / 20分钟后 / 2小时后 / 3天后 / 10秒后
  const rel = /(\d+(?:\.\d+)?|半|一)\s*个?\s*(秒|s|分钟|分|小时|钟头|天)\s*(?:后|以后|之后)/i.exec(text);
  if (rel) {
    const amount = rel[1] === '半' ? 0.5 : rel[1] === '一' ? 1 : Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const ms =
      unit === '天'
        ? amount * 86400000
        : unit === '秒' || unit === 's'
          ? amount * 1000
          : unit === '分钟' || unit === '分'
            ? amount * 60000
            : amount * 3600000;
    const at = now.getTime() + Math.max(1000, Math.round(ms));
    spans.push([rel.index, rel.index + rel[0].length]);
    return {
      at,
      title: cleanTitle(original, spans),
      hasDate: true,
      hasTime: true,
    };
  }

  // 2) 日期
  const datePatterns = [
    {
      re: /大后天|后天|明天|明日|明晚|明早|今天|今日|今晚|今早|今儿/g,
      handle: (m) => {
        const word = m[0];
        dayOffset = word === '大后天' ? 3 : word === '后天' ? 2 : ['明天', '明日', '明晚', '明早'].includes(word) ? 1 : 0;
        if (word === '今晚' || word === '明晚') periodFromDate = '晚上';
        if (word === '今早' || word === '明早') periodFromDate = '早上';
        dateExplicit = true;
      },
    },
    {
      re: /下下(?:周|星期|礼拜)([一二三四五六日天])/g,
      handle: (m) => {
        const target = weekdayIndex(m[1]);
        if (target == null) return;
        const targetMon = target === 0 ? 6 : target - 1;
        const untilNextMon = (8 - now.getDay()) % 7 || 7;
        dayOffset = untilNextMon + targetMon + 7;
        dateExplicit = true;
      },
    },
    {
      re: /下(?:周|星期|礼拜)([一二三四五六日天])/g,
      handle: (m) => {
        const target = weekdayIndex(m[1]);
        if (target == null) return;
        const targetMon = target === 0 ? 6 : target - 1;
        const untilNextMon = (8 - now.getDay()) % 7 || 7;
        dayOffset = untilNextMon + targetMon;
        dateExplicit = true;
      },
    },
    {
      re: /本?(?:周|星期|礼拜)([一二三四五六日天])/g,
      handle: (m) => {
        const target = weekdayIndex(m[1]);
        if (target == null) return;
        const cur = now.getDay();
        let diff = (target - cur + 7) % 7;
        if (diff === 0 && !m[0].startsWith('本')) diff = 7;
        dayOffset = diff;
        dateExplicit = true;
      },
    },
    {
      re: /(\d{4})\s*[年/-]\s*(\d{1,2})\s*[月/-]\s*(\d{1,2})\s*[日号]?/g,
      handle: (m) => {
        baseDate = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        dayOffset = null;
        dateExplicit = true;
      },
    },
    {
      re: /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/g,
      handle: (m) => {
        baseDate = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]));
        if (baseDate.getTime() < startOfDay(now).getTime() - 86400000) baseDate.setFullYear(now.getFullYear() + 1);
        dayOffset = null;
        dateExplicit = true;
      },
    },
    {
      re: /下个?月\s*(\d{1,2})\s*[日号]/g,
      handle: (m) => {
        baseDate = new Date(now.getFullYear(), now.getMonth() + 1, Number(m[1]));
        dayOffset = null;
        dateExplicit = true;
      },
    },
    {
      re: /(\d{1,2})\s*[日号]/g,
      handle: (m) => {
        const day = Number(m[1]);
        if (day < 1 || day > 31) return;
        baseDate = new Date(now.getFullYear(), now.getMonth(), day);
        if (baseDate.getTime() < startOfDay(now).getTime()) baseDate.setMonth(baseDate.getMonth() + 1);
        dayOffset = null;
        dateExplicit = true;
      },
    },
    {
      re: /月底/g,
      handle: () => {
        baseDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        dayOffset = null;
        dateExplicit = true;
      },
    },
  ];

  for (const p of datePatterns) {
    const re = new RegExp(p.re.source, 'g');
    let m;
    while ((m = re.exec(text))) {
      if (overlaps(spans, m.index, m.index + m[0].length)) continue;
      p.handle(m);
      spans.push([m.index, m.index + m[0].length]);
      break;
    }
  }

  // 3) 时间
  const timePatterns = [
    {
      re: /(凌晨|早上|上午|中午|下午|傍晚|晚上|夜里)?\s*(\d{1,2})\s*[:：]\s*(\d{1,2})/g,
      handle: (m) => {
        let h = Number(m[2]);
        const min = Number(m[3]);
        if (h > 23 || min > 59) return;
        h = applyPeriod(h, m[1]);
        hour = h;
        minute = min;
        hasTime = true;
      },
    },
    {
      re: /(凌晨|早上|上午|中午|下午|傍晚|晚上|夜里)?\s*(\d{1,2})\s*点\s*(半|一刻|三刻|(\d{1,2})\s*分?)?/g,
      handle: (m) => {
        let h = Number(m[2]);
        if (h > 24) return;
        let min = 0;
        if (m[3] === '半') min = 30;
        else if (m[3] === '一刻') min = 15;
        else if (m[3] === '三刻') min = 45;
        else if (m[4]) min = Number(m[4]);
        if (min > 59) return;
        h = applyPeriod(h, m[1]);
        if (h === 24) h = 0;
        hour = h;
        minute = min;
        hasTime = true;
      },
    },
  ];

  for (const p of timePatterns) {
    const re = new RegExp(p.re.source, 'g');
    let m;
    while ((m = re.exec(text))) {
      if (overlaps(spans, m.index, m.index + m[0].length)) continue;
      p.handle(m);
      spans.push([m.index, m.index + m[0].length]);
      break;
    }
  }

  if (!hasTime) {
    const re = /(凌晨|早上|上午|中午|下午|傍晚|晚上|夜里)/g;
    let m;
    while ((m = re.exec(text))) {
      if (overlaps(spans, m.index, m.index + m[0].length)) continue;
      hour = PERIOD_DEFAULT[m[1]];
      minute = 0;
      hasTime = true;
      spans.push([m.index, m.index + m[0].length]);
      break;
    }
  }

  if (!dateExplicit && !hasTime) {
    return { at: null, title: original, hasDate: false, hasTime: false };
  }

  if (!dateExplicit) {
    baseDate = startOfDay(now);
    if (!hasTime) {
      hour = 9;
      hasTime = true;
    }
    const candidate = new Date(baseDate);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1);
    return { at: candidate.getTime(), title: cleanTitle(original, spans), hasDate: true, hasTime: true };
  }

  if (dayOffset != null) {
    baseDate = startOfDay(now);
    baseDate.setDate(baseDate.getDate() + dayOffset);
  }
  if (!hasTime) {
    hour = periodFromDate ? PERIOD_DEFAULT[periodFromDate] : 9;
    minute = 0;
  } else if (periodFromDate) {
    // “明晚” 已由时间表达式的“晚上”处理；这里只兜底没有具体点数的情况
    hour = applyPeriod(hour, periodFromDate);
  }
  const at = new Date(baseDate);
  at.setHours(hour, minute, 0, 0);
  return { at: at.getTime(), title: cleanTitle(original, spans), hasDate: true, hasTime: true };
}

function cleanTitle(original, spans) {
  if (!spans.length) return original;
  let out = '';
  let cursor = 0;
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  for (const [a, b] of sorted) {
    if (a > cursor) out += original.slice(cursor, a);
    cursor = Math.max(cursor, b);
  }
  out += original.slice(cursor);
  out = out
    .replace(/\s+/g, ' ')
    .replace(/^[，,。.、;；:：\s]+/, '')
    .replace(/^(提醒我|记得|别忘了|帮我|请帮我|麻烦你|麻烦|我得)\s*/, '')
    .replace(/^[，,。.、;；:：\s]+/, '')
    .trim();
  return out.length >= 2 ? out : original;
}

function formatDateTime(ms, now = Date.now()) {
  if (!ms) return '未设置';
  const d = new Date(ms);
  const n = new Date(now);
  const wd = '日一二三四五六'[d.getDay()];
  const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const sameYear = d.getFullYear() === n.getFullYear();
  const date = sameYear ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return `${date} 周${wd} ${hm}`;
}

function formatIsoLocal(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

module.exports = { parseWhen, formatDateTime, formatIsoLocal, cleanTitle, cnToNum };
