'use strict';

const { makeTask } = require('./state');
const { parseWhen } = require('./time');
const { startOfDay, endOfDay, uid, nowIso, truncate } = require('./util');

const ACTIVE = new Set(['todo', 'doing']);

class TaskService {
  constructor({ store }) {
    this.store = store;
  }

  get data() {
    return this.store.data;
  }

  _leadMs() {
    const lead = Number(this.data.settings.schedule.reminderLeadMinutes) || 0;
    return lead * 60000;
  }

  _normalizeDue(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) {
        const t = Date.parse(value);
        if (Number.isFinite(t)) return t;
      }
      const parsed = parseWhen(value);
      if (parsed.at) return parsed.at;
      const t = Date.parse(value);
      if (Number.isFinite(t)) return t;
    }
    return null;
  }

  create(input = {}) {
    const title = String(input.title || '').trim();
    if (!title) throw new Error('事项标题不能为空');
    let dueAt = this._normalizeDue(input.dueAt ?? input.when);
    let remindAt = this._normalizeDue(input.remindAt);
    const lead = this._leadMs();
    if (remindAt == null && dueAt != null && input.remind !== false) {
      remindAt = dueAt - lead;
      if (remindAt < Date.now() - 60000) remindAt = Math.max(Date.now() + 30000, dueAt);
    }
    const task = makeTask({
      ...input,
      title: title.slice(0, 200),
      dueAt,
      remindAt,
      tags: Array.isArray(input.tags) ? input.tags : [],
    });
    this.store.mutate((s) => {
      s.tasks.unshift(task);
      if (s.tasks.length > 3000) s.tasks.length = 3000;
    });
    return task;
  }

  get(id) {
    return this.data.tasks.find((t) => t.id === id) || null;
  }

  update(id, patch = {}) {
    const task = this.get(id);
    if (!task) throw new Error('事项不存在');
    this.store.mutate(() => {
      if (patch.title != null) task.title = String(patch.title).trim().slice(0, 200) || task.title;
      if (patch.notes != null) task.notes = String(patch.notes).slice(0, 4000);
      if (patch.priority != null) task.priority = Math.min(3, Math.max(0, Number(patch.priority) || 0));
      if (patch.tags != null) task.tags = (Array.isArray(patch.tags) ? patch.tags : []).map(String).slice(0, 6);
      if (patch.dueAt !== undefined) {
        task.dueAt = this._normalizeDue(patch.dueAt);
        task.remindedAt = null;
        if (patch.remindAt === undefined) {
          task.remindAt = task.dueAt != null ? task.dueAt - this._leadMs() : null;
        }
      }
      if (patch.remindAt !== undefined) {
        task.remindAt = this._normalizeDue(patch.remindAt);
        task.remindedAt = null;
      }
      if (patch.status && ['todo', 'doing', 'done', 'cancelled'].includes(patch.status)) {
        task.status = patch.status;
        task.completedAt = patch.status === 'done' ? nowIso() : null;
      }
      if (patch.agentId !== undefined) task.agentId = patch.agentId || null;
      task.updatedAt = nowIso();
    });
    return task;
  }

  complete(id) {
    return this.update(id, { status: 'done' });
  }

  reopen(id) {
    return this.update(id, { status: 'todo' });
  }

  remove(id) {
    const idx = this.data.tasks.findIndex((t) => t.id === id);
    if (idx < 0) return false;
    this.store.mutate((s) => s.tasks.splice(idx, 1));
    return true;
  }

  list({ scope = 'active', limit = 200 } = {}) {
    const now = Date.now();
    const eod = endOfDay().getTime();
    let items = this.data.tasks;
    if (scope === 'today') {
      items = items.filter((t) => ACTIVE.has(t.status) && ((t.dueAt && t.dueAt <= eod) || t.status === 'doing'));
    } else if (scope === 'overdue') {
      items = items.filter((t) => ACTIVE.has(t.status) && t.dueAt && t.dueAt < now);
    } else if (scope === 'upcoming') {
      items = items.filter((t) => ACTIVE.has(t.status) && t.dueAt && t.dueAt > eod);
    } else if (scope === 'active' || scope === 'all') {
      items = items.filter((t) => ACTIVE.has(t.status));
    } else if (scope === 'done') {
      items = items.filter((t) => t.status === 'done');
    } else if (scope === 'cancelled') {
      items = items.filter((t) => t.status === 'cancelled');
    }
    const prio = (t) => (t.priority == null ? 1 : t.priority);
    items = [...items].sort((a, b) => {
      const ad = a.dueAt || Number.MAX_SAFE_INTEGER;
      const bd = b.dueAt || Number.MAX_SAFE_INTEGER;
      if (ad !== bd) return ad - bd;
      if (prio(a) !== prio(b)) return prio(b) - prio(a);
      return String(a.createdAt).localeCompare(String(b.createdAt));
    });
    return items.slice(0, limit);
  }

  dueReminders(now = Date.now()) {
    return this.data.tasks.filter(
      (t) => ACTIVE.has(t.status) && t.remindAt && t.remindAt <= now && !t.remindedAt
    );
  }

  markReminded(id, at = Date.now()) {
    const t = this.get(id);
    if (!t) return;
    this.store.mutate(() => {
      t.remindedAt = at;
    });
  }

  stats() {
    const now = Date.now();
    const sod = startOfDay().getTime();
    const eod = endOfDay().getTime();
    const active = this.data.tasks.filter((t) => ACTIVE.has(t.status));
    const today = active.filter((t) => t.dueAt && t.dueAt >= sod && t.dueAt <= eod);
    const overdue = active.filter((t) => t.dueAt && t.dueAt < now);
    const doneToday = this.data.tasks.filter(
      (t) => t.status === 'done' && t.completedAt && Date.parse(t.completedAt) >= sod && Date.parse(t.completedAt) <= eod
    );
    const next = active
      .filter((t) => t.dueAt && t.dueAt >= now)
      .sort((a, b) => a.dueAt - b.dueAt)[0] || null;
    return {
      activeCount: active.length,
      todayCount: today.length,
      overdueCount: overdue.length,
      doneTodayCount: doneToday.length,
      next,
    };
  }

  summaryForPrompt(limit = 12) {
    const active = this.list({ scope: 'active', limit });
    const stats = this.stats();
    return {
      date: new Date().toLocaleString('zh-CN', { hour12: false }),
      stats,
      items: active.map((t) => ({
        id: t.id,
        title: truncate(t.title, 80),
        status: t.status,
        priority: t.priority,
        dueAt: t.dueAt,
        tags: t.tags,
      })),
    };
  }

  quickAdd(text) {
    const raw = String(text || '').trim();
    if (!raw) throw new Error('说点什么再记吧');
    const parsed = parseWhen(raw);
    const title = (parsed.title || raw).trim();
    return this.create({
      title,
      dueAt: parsed.at,
      priority: parsed.at ? 1 : 0,
      source: 'quick',
      remind: true,
    });
  }

  addNote(content, tags = []) {
    const note = {
      id: uid('note'),
      content: String(content || '').trim().slice(0, 8000),
      tags: (Array.isArray(tags) ? tags : []).map(String).slice(0, 6),
      createdAt: nowIso(),
    };
    if (!note.content) throw new Error('笔记内容为空');
    this.store.mutate((s) => {
      s.notes.unshift(note);
      if (s.notes.length > 1000) s.notes.length = 1000;
    });
    return note;
  }

  listNotes(limit = 30) {
    return this.data.notes.slice(0, limit);
  }
}

module.exports = { TaskService, ACTIVE };
