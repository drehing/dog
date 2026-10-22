'use strict';

const { parseClock, localDateKey, humanWhen, truncate } = require('./util');

class Scheduler {
  constructor({ store, tasks, agents, supervisor, notify }) {
    this.store = store;
    this.tasks = tasks;
    this.agents = agents;
    this.supervisor = supervisor;
    this.notify = notify;
    this.timer = null;
    this.busy = false;
    this.lastTickAt = 0;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch((e) => console.warn('[scheduler]', e.message)), 5000);
    setTimeout(() => this.tick().catch(() => {}), 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    this.lastTickAt = Date.now();
    try {
      this.checkReminders();
      this.checkStaleRuns();
      await this.checkBriefing();
      await this.checkReview();
      await this.checkSupervision();
    } finally {
      this.busy = false;
    }
  }

  checkReminders() {
    const due = this.tasks.dueReminders(Date.now());
    for (const task of due) {
      const body = [
        task.dueAt ? `${humanWhen(task.dueAt)}${task.dueAt < Date.now() - 5 * 60000 ? '（已到点）' : ''}` : '',
        task.notes ? truncate(task.notes, 120) : '',
      ]
        .filter(Boolean)
        .join('\n');
      this.notify({
        kind: 'reminder',
        title: task.title,
        body: body || '到点了，记得处理一下。',
        short: `${task.title}${task.dueAt ? ' · ' + humanWhen(task.dueAt) : ''}`,
        meta: { taskId: task.id },
        dedupeKey: `reminder:${task.id}:${task.remindAt || task.dueAt || ''}`,
      });
      this.tasks.markReminded(task.id);
    }
  }

  checkStaleRuns() {
    const now = Date.now();
    for (const run of this.agents.activeRuns()) {
      if (run.status !== 'running' || run.needsAttention) continue;
      const threshold = Math.max(45, (run.checkInMinutes || 30) * 2) * 60000;
      if (now - run.lastReportAt < threshold) continue;
      if (run.lastStaleAt && now - run.lastStaleAt < 60 * 60000) continue;
      run.lastStaleAt = now;
      const mins = Math.round((now - run.lastReportAt) / 60000);
      this.agents.report(run.id, {
        status: 'waiting',
        message: `已经 ${mins} 分钟没有收到汇报`,
        needsAttention: true,
        attentionReason: `超过 ${mins} 分钟没有汇报，可能卡住了`,
        level: 'warn',
        source: 'system',
      });
    }
  }

  _timeDue(timeStr, lastKey, today, windowHours) {
    const t = parseClock(timeStr);
    if (!t) return false;
    const now = new Date();
    const target = new Date(now);
    target.setHours(t.h, t.min, 0, 0);
    if (now.getTime() < target.getTime()) return false;
    if (now.getTime() - target.getTime() > windowHours * 3600000) return false;
    return this.store.data.meta[lastKey] !== today;
  }

  async checkBriefing() {
    if (!this.store.data.meta.onboarded) return;
    const cfg = this.store.data.settings.schedule.briefing;
    if (!cfg?.enabled) return;
    const today = localDateKey();
    if (!this._timeDue(cfg.time, 'lastBriefingDate', today, 4)) return;
    await this.supervisor.briefing();
  }

  async checkReview() {
    if (!this.store.data.meta.onboarded) return;
    const cfg = this.store.data.settings.schedule.review;
    if (!cfg?.enabled) return;
    const today = localDateKey();
    if (!this._timeDue(cfg.time, 'lastReviewDate', today, 3)) return;
    await this.supervisor.review();
  }

  async checkSupervision() {
    if (!this.store.data.meta.onboarded) return;
    const cfg = this.store.data.settings.schedule.supervision;
    if (!cfg?.enabled) return;
    if (!this.agents.activeRuns().length) return;
    const interval = Math.max(10, Number(cfg.intervalMinutes) || 60) * 60000;
    const last = this.store.data.meta.lastSupervisionAt ? Date.parse(this.store.data.meta.lastSupervisionAt) : 0;
    if (Date.now() - last < interval) return;
    await this.supervisor.reviewRuns({ trigger: 'schedule' });
  }

  mute(minutes = 60) {
    const until = Date.now() + Math.max(1, minutes) * 60000;
    this.store.mutate((s) => {
      s.meta.mutedUntil = until;
    });
    return until;
  }

  unmute() {
    this.store.mutate((s) => {
      s.meta.mutedUntil = null;
    });
  }

  status() {
    const now = Date.now();
    const mutedUntil = this.store.data.meta.mutedUntil;
    const nextReminder = this.tasks
      .list({ scope: 'active', limit: 500 })
      .filter((t) => t.remindAt && t.remindAt > now)
      .sort((a, b) => a.remindAt - b.remindAt)[0];
    return {
      running: Boolean(this.timer),
      lastTickAt: this.lastTickAt,
      mutedUntil: mutedUntil && mutedUntil > now ? mutedUntil : null,
      nextReminder: nextReminder ? { title: nextReminder.title, at: nextReminder.remindAt } : null,
    };
  }
}

module.exports = { Scheduler };
