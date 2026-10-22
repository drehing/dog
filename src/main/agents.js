'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { makeAgent, makeRun } = require('./state');
const { ensureDir, truncate, uid, nowIso } = require('./util');

const ACTIVE_STATUS = new Set(['queued', 'running', 'waiting', 'blocked']);
const FINAL_STATUS = new Set(['done', 'failed', 'cancelled']);
const STATUS_TEXT = {
  queued: '排队中',
  running: '进行中',
  waiting: '等待中',
  blocked: '被卡住',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const ATTENTION_RE = /(等待你的|需要你(的)?(确认|授权|决定)|请确认|需要确认|无法继续|无法完成|卡住了|blocked|waiting for (your )?(input|approval)|permission denied)/i;

function stripAnsi(s) {
  return String(s || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

function splitArgs(str) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(str || '')))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

class AgentService extends EventEmitter {
  constructor({ store, tasks, dataDir, getLLM, getApiInfo }) {
    super();
    this.store = store;
    this.tasks = tasks;
    this.dataDir = dataDir;
    this.getLLM = getLLM;
    this.getApiInfo = getApiInfo || (() => null);
    this.children = new Map();
    this.logs = new Map();
    this._shutdown = false;
  }

  get data() {
    return this.store.data;
  }

  list() {
    const runs = this.data.runs;
    return this.data.agents
      .filter((a) => !a.archived)
      .map((a) => {
        const agentRuns = runs.filter((r) => r.agentId === a.id).sort((x, y) => y.startedAt - x.startedAt);
        const currentRun = agentRuns.find((r) => ACTIVE_STATUS.has(r.status)) || null;
        const lastRun = agentRuns[0] || null;
        return {
          ...a,
          currentRun: currentRun ? this._publicRun(currentRun) : null,
          lastRun: lastRun ? this._publicRun(lastRun) : null,
          stats: {
            total: agentRuns.length,
            done: agentRuns.filter((r) => r.status === 'done').length,
            failed: agentRuns.filter((r) => r.status === 'failed').length,
          },
        };
      });
  }

  get(id) {
    return this.data.agents.find((a) => a.id === id) || null;
  }

  create(input) {
    if (input?.kind === 'internal' && input.name) {
      // 内部智能体开箱即用
    }
    if (input?.kind === 'cli' && !String(input.command || '').trim()) {
      throw new Error('CLI 智能体需要填写可执行命令');
    }
    if (input?.kind === 'http' && !String(input.dispatchUrl || '').trim()) {
      // 允许只创建，靠 /v1/report 上报
    }
    const agent = makeAgent(input);
    this.store.mutate((s) => s.agents.unshift(agent));
    return agent;
  }

  update(id, patch) {
    const agent = this.get(id);
    if (!agent) throw new Error('智能体不存在');
    this.store.mutate(() => {
      for (const key of ['name', 'description', 'color', 'systemPrompt', 'command', 'argsTemplate', 'cwd', 'dispatchUrl']) {
        if (patch[key] != null) agent[key] = String(patch[key]).slice(0, key === 'systemPrompt' ? 4000 : 1000);
      }
      if (['internal', 'cli', 'http'].includes(patch.kind)) agent.kind = patch.kind;
      if (['arg', 'stdin', 'env'].includes(patch.promptVia)) agent.promptVia = patch.promptVia;
      if (patch.checkInMinutes != null) agent.checkInMinutes = Math.min(240, Math.max(5, Number(patch.checkInMinutes) || 30));
      if (patch.archived != null) agent.archived = Boolean(patch.archived);
      agent.updatedAt = nowIso();
    });
    return agent;
  }

  remove(id) {
    const agent = this.get(id);
    if (!agent) return false;
    const active = this.data.runs.find((r) => r.agentId === id && ACTIVE_STATUS.has(r.status));
    if (active) this.cancel(active.id);
    this.store.mutate((s) => {
      const i = s.agents.findIndex((a) => a.id === id);
      if (i >= 0) s.agents.splice(i, 1);
    });
    return true;
  }

  activeRuns() {
    return this.data.runs.filter((r) => ACTIVE_STATUS.has(r.status));
  }

  getRun(id) {
    const run = this.data.runs.find((r) => r.id === id);
    if (!run) return null;
    return {
      ...this._publicRun(run),
      reports: this.data.reports
        .filter((r) => r.runId === id)
        .sort((a, b) => a.at - b.at)
        .slice(-80),
    };
  }

  _publicRun(run) {
    return {
      id: run.id,
      agentId: run.agentId,
      agentName: run.agentName,
      taskId: run.taskId,
      title: run.title,
      prompt: run.prompt,
      status: run.status,
      progress: run.progress,
      summary: run.summary,
      needsAttention: run.needsAttention,
      attentionReason: run.attentionReason,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      endedAt: run.endedAt,
      lastReportAt: run.lastReportAt,
      checkInMinutes: run.checkInMinutes,
    };
  }

  startRun({ agentId, prompt, title, taskId = null, source = 'user' }) {
    const agent = this.get(agentId);
    if (!agent) throw new Error('智能体不存在');
    const text = String(prompt || '').trim();
    if (!text) throw new Error('请先写清楚要它做什么');
    const run = makeRun({
      agentId,
      agentName: agent.name,
      taskId,
      title: String(title || text).trim().slice(0, 120),
      prompt: text,
      checkInMinutes: agent.checkInMinutes,
    });
    run.status = 'queued';
    ensureDir(path.join(this.dataDir, 'logs'));
    run.logFile = path.join(this.dataDir, 'logs', `${run.id}.log`);
    this.store.mutate((s) => {
      s.runs.unshift(run);
      if (s.runs.length > 1000) s.runs.length = 1000;
      if (taskId) {
        const task = s.tasks.find((t) => t.id === taskId);
        if (task) task.status = 'doing';
      }
    });
    this.appendReport(run, { message: '任务已接收，开始执行', status: 'running', progress: 5 }, 'system');

    if (agent.kind === 'internal') this._runInternal(agent, run);
    else if (agent.kind === 'cli') this._runCli(agent, run);
    else this._dispatchHttp(agent, run);
    return run;
  }

  async _runInternal(agent, run) {
    try {
      this.updateRun(run, { status: 'running', progress: 15 });
      const llm = this.getLLM();
      let text;
      if (!llm || llm.isMock) {
        await new Promise((r) => setTimeout(r, 900));
        text = this._mockDeliverable(agent, run.prompt);
      } else {
        const res = await llm.chat({
          system:
            `${agent.systemPrompt}\n\n` +
            '你正在作为独立智能体执行任务。直接产出可交付的结果，不要寒暄，不要询问，不要提及自己是 AI。' +
            '结构清晰，控制在 800 字以内，结尾给出一句「下一步建议」。',
          messages: [{ role: 'user', content: run.prompt }],
          maxTokens: 2400,
          temperature: 0.5,
        });
        text = (res.text || '').trim();
      }
      if (!text) throw new Error('模型没有返回成果');
      if (this._shutdown) return;
      this.updateRun(run, { progress: 90 });
      this.finish(run, 'done', { summary: text });
    } catch (err) {
      if (this._shutdown) return;
      this.finish(run, 'failed', { summary: `执行失败：${err.message}` });
    }
  }

  _mockDeliverable(agent, prompt) {
    const topic = truncate(prompt, 60);
    return [
      `【演示成果 · ${agent.name}】`,
      `任务：${topic}`,
      '',
      '结论',
      '已完成任务拆解与初步处理，产出可以直接进入下一步。演示模式没有调用真实模型，这里是一份占位成果。',
      '',
      '要点',
      '1. 目标已经明确，关键信息齐全；',
      '2. 已整理出可执行的三个步骤；',
      '3. 风险点在于缺少真实数据源，接入模型后可补齐。',
      '',
      '下一步建议：在设置中配置真实模型 Key，再让我跑一次，就能得到正式结果。',
    ].join('\n');
  }

  _runCli(agent, run) {
    const args = splitArgs(agent.argsTemplate || '{prompt}');
    let finalArgs = args.map((a) => a.replace(/\{prompt\}/g, run.prompt));
    if (!args.some((a) => a.includes('{prompt}')) && agent.promptVia === 'arg') {
      finalArgs = [...finalArgs, run.prompt];
    }
    if (agent.promptVia === 'stdin' || agent.promptVia === 'env') {
      finalArgs = finalArgs.filter((a) => a !== run.prompt);
    }
    const api = this.getApiInfo();
    const env = {
      ...process.env,
      DOG_RUN_ID: run.id,
      DOG_AGENT_ID: agent.id,
      DOG_PROMPT: run.prompt,
      DOG_REPORT_URL: api?.url ? `${api.url}/v1/report` : '',
      DOG_TOKEN: api?.token || '',
    };
    let child;
    try {
      child = spawn(agent.command, finalArgs, {
        cwd: agent.cwd && fs.existsSync(agent.cwd) ? agent.cwd : undefined,
        env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.failRun(run, `无法启动命令：${err.message}`);
      return;
    }
    this.children.set(run.id, child);
    const log = fs.createWriteStream(run.logFile, { flags: 'a' });
    this.logs.set(run.id, log);
    log.write(`# ${new Date().toISOString()} ${agent.name} · ${run.title}\n# cmd: ${agent.command} ${finalArgs.join(' ')}\n\n`);
    this.updateRun(run, { status: 'running', progress: 10, pid: child.pid || null });
    this.appendReport(run, { message: `已启动进程 ${child.pid || ''}`.trim(), status: 'running', progress: 10 }, 'system');

    if (agent.promptVia === 'stdin') {
      try {
        child.stdin.write(run.prompt + '\n');
        child.stdin.end();
      } catch {}
    }

    const tail = [];
    let buffer = '';
    let lastAttention = 0;
    let lastLogReport = 0;
    const onChunk = (chunk, isErr) => {
      const text = stripAnsi(chunk.toString());
      log.write(text);
      buffer += text;
      let idx;
      while ((idx = buffer.search(/\r?\n/)) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + (buffer[idx] === '\r' ? 2 : 1));
        if (!line) continue;
        tail.push(line);
        if (tail.length > 200) tail.shift();
        this._handleLine(run, line);
        if (Date.now() - lastLogReport > 120000) {
          lastLogReport = Date.now();
          this.touch(run);
        }
        if (!run.needsAttention && Date.now() - lastAttention > 300000 && ATTENTION_RE.test(line) && tail.length > 2) {
          lastAttention = Date.now();
          this.report(run.id, {
            status: 'waiting',
            message: truncate(line, 200),
            needsAttention: true,
            attentionReason: truncate(line, 160),
            level: 'warn',
          });
        }
      }
      if (isErr && text.trim() && !run.needsAttention && ATTENTION_RE.test(text)) {
        this.report(run.id, {
          status: 'waiting',
          message: truncate(text.trim(), 200),
          needsAttention: true,
          attentionReason: truncate(text.trim(), 160),
          level: 'warn',
        });
      }
    };
    child.stdout.on('data', (c) => onChunk(c, false));
    child.stderr.on('data', (c) => onChunk(c, true));
    child.on('error', (err) => {
      this.failRun(run, `命令启动失败：${err.message}`);
      this._cleanupChild(run.id);
    });
    child.on('close', (code) => {
      this._cleanupChild(run.id);
      if (FINAL_STATUS.has(run.status)) return;
      const summary = tail.slice(-12).join('\n').trim();
      if (code === 0) {
        this.finish(run, 'done', { summary: summary || '命令执行完成（无输出）' });
      } else {
        this.finish(run, 'failed', { summary: `进程退出码 ${code}\n${truncate(summary, 800)}` });
      }
    });
  }

  _handleLine(run, line) {
    const m = /^(?:DOG_REPORT\s+)?(\{.*\})\s*$/.exec(line);
    if (!m) return;
    try {
      const obj = JSON.parse(m[1]);
      const report = obj?.dog || (obj?.type === 'dog-report' ? obj : obj?.status ? obj : null);
      if (report && typeof report === 'object') {
        this.report(run.id, {
          status: report.status,
          progress: report.progress,
          message: report.message,
          summary: report.summary,
          needsAttention: report.needsAttention,
          attentionReason: report.attentionReason,
          level: report.level,
        });
      }
    } catch {}
  }

  async _dispatchHttp(agent, run) {
    const api = this.getApiInfo();
    if (!agent.dispatchUrl) {
      this.updateRun(run, { status: 'waiting' });
      this.appendReport(
        run,
        {
          message: '已登记任务，等待外部智能体通过本地接口上报进度',
          status: 'waiting',
          progress: 5,
        },
        'system'
      );
      return;
    }
    try {
      const res = await fetch(agent.dispatchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(api?.token ? { 'x-dog-token': api.token } : {}),
        },
        body: JSON.stringify({
          runId: run.id,
          agentId: agent.id,
          agentName: agent.name,
          prompt: run.prompt,
          title: run.title,
          reportUrl: api?.url ? `${api.url}/v1/report` : '',
          token: api?.token || '',
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.updateRun(run, { status: 'running', progress: 10 });
      this.appendReport(run, { message: '已投递给外部智能体', status: 'running', progress: 10 }, 'system');
    } catch (err) {
      this.failRun(run, `投递失败：${err.message}`);
    }
  }

  updateRun(run, patch) {
    this.store.mutate(() => {
      Object.assign(run, patch);
      run.updatedAt = Date.now();
    });
  }

  touch(run) {
    this.store.mutate(() => {
      run.lastReportAt = Date.now();
    });
  }

  appendReport(run, report, source = 'agent') {
    const item = {
      id: uid('rep'),
      runId: run.id,
      at: Date.now(),
      status: report.status || run.status,
      progress: Number.isFinite(Number(report.progress)) ? Math.min(100, Math.max(0, Number(report.progress))) : run.progress,
      message: String(report.message || '').slice(0, 2000),
      level: ['info', 'warn', 'error', 'success'].includes(report.level) ? report.level : 'info',
      source,
    };
    this.store.mutate((s) => {
      s.reports.push(item);
      if (s.reports.length > 4000) s.reports.splice(0, s.reports.length - 4000);
      run.lastReportAt = item.at;
      run.updatedAt = item.at;
    });
    return item;
  }

  report(runId, input = {}) {
    const run = this.data.runs.find((r) => r.id === runId);
    if (!run) throw new Error('找不到这个任务');
    if (FINAL_STATUS.has(run.status)) return this._publicRun(run);
    const status = ['queued', 'running', 'waiting', 'blocked', 'done', 'failed', 'cancelled'].includes(input.status)
      ? input.status
      : run.status;
    const wasFinal = FINAL_STATUS.has(run.status);
    const progress = Number.isFinite(Number(input.progress)) ? Math.min(100, Math.max(0, Number(input.progress))) : run.progress;
    const wasAttention = run.needsAttention;
    this.store.mutate(() => {
      run.status = status;
      run.progress = status === 'done' ? 100 : progress;
      run.updatedAt = Date.now();
      run.lastReportAt = Date.now();
      if (input.summary) run.summary = String(input.summary).slice(0, 6000);
      if (input.needsAttention != null) {
        run.needsAttention = Boolean(input.needsAttention);
        if (!run.needsAttention) run.attentionReason = '';
      }
      if (input.attentionReason) run.attentionReason = String(input.attentionReason).slice(0, 500);
      if (['waiting', 'blocked'].includes(status) && input.needsAttention !== false) {
        run.needsAttention = true;
        if (!run.attentionReason) run.attentionReason = String(input.message || '智能体在等待').slice(0, 500);
      }
    });
    this.appendReport(
      run,
      {
        status,
        progress: run.progress,
        message: input.message || STATUS_TEXT[status] || '',
        level: input.level || (status === 'failed' ? 'error' : status === 'done' ? 'success' : status === 'blocked' ? 'warn' : 'info'),
      },
      input.source || 'agent'
    );
    if (!wasAttention && run.needsAttention) {
      const agent = this.get(run.agentId);
      this.emit('run:attention', { run, agent });
    }
    if (FINAL_STATUS.has(status)) {
      if (!run.endedAt) run.endedAt = Date.now();
      if (status === 'done') this._completeRun(run);
      if (!wasFinal) this._endRun(run, status, input.summary);
    }
    return this._publicRun(run);
  }

  finish(run, status, { summary } = {}) {
    if (FINAL_STATUS.has(run.status)) return;
    const wasFinal = FINAL_STATUS.has(run.status);
    this.store.mutate(() => {
      run.status = status;
      run.progress = status === 'done' ? 100 : run.progress;
      run.endedAt = Date.now();
      run.updatedAt = Date.now();
      if (summary) run.summary = String(summary).slice(0, 6000);
      run.needsAttention = false;
      run.attentionReason = '';
    });
    this.appendReport(
      run,
      {
        status,
        progress: run.progress,
        message: status === 'done' ? '任务完成' : '任务结束',
        level: status === 'done' ? 'success' : 'error',
      },
      'system'
    );
    if (status === 'done') this._completeRun(run);
    if (!wasFinal) this._endRun(run, status, summary);
  }

  _completeRun(run) {
    if (!run.taskId) return;
    const task = this.data.tasks.find((t) => t.id === run.taskId);
    if (task && (task.status === 'todo' || task.status === 'doing')) {
      this.tasks.complete(task.id);
    }
  }

  _endRun(run, status) {
    if (run.notifiedStatus === status) return;
    run.notifiedStatus = status;
    run.endedAt = run.endedAt || Date.now();
    this.store.save();
    this.emit('run:done', { run, agent: this.get(run.agentId) });
  }

  failRun(run, message) {
    if (FINAL_STATUS.has(run.status)) return;
    this.finish(run, 'failed', { summary: message });
  }

  cancel(runId) {
    const run = this.data.runs.find((r) => r.id === runId);
    if (!run || FINAL_STATUS.has(run.status)) return false;
    const child = this.children.get(runId);
    if (child) {
      try {
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        else child.kill('SIGTERM');
      } catch {}
    }
    this.finish(run, 'cancelled', { summary: '已由用户取消' });
    return true;
  }

  acknowledge(runId) {
    const run = this.data.runs.find((r) => r.id === runId);
    if (!run) return false;
    this.store.mutate(() => {
      run.needsAttention = false;
      run.attentionReason = '';
      run.updatedAt = Date.now();
    });
    this.appendReport(run, { message: '用户已查看并确认', status: run.status, progress: run.progress, level: 'info' }, 'user');
    return true;
  }

  instruct(runId, message) {
    const run = this.data.runs.find((r) => r.id === runId);
    if (!run) throw new Error('找不到这个任务');
    if (FINAL_STATUS.has(run.status)) throw new Error('这个任务已经结束了');
    const text = String(message || '').trim();
    if (!text) throw new Error('指令不能为空');
    const child = this.children.get(runId);
    if (child?.stdin?.writable) {
      child.stdin.write(text + '\n');
    }
    this.appendReport(run, { message: `你补充了指令：${truncate(text, 300)}`, status: run.status, progress: run.progress, level: 'info' }, 'user');
    this.store.mutate(() => {
      run.updatedAt = Date.now();
    });
    return true;
  }

  getLog(runId) {
    const run = this.data.runs.find((r) => r.id === runId);
    if (!run || !run.logFile) return '';
    try {
      const stat = fs.statSync(run.logFile);
      const start = Math.max(0, stat.size - 60 * 1024);
      const fd = fs.openSync(run.logFile, 'r');
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      return stripAnsi(buf.toString('utf8')).slice(-20000);
    } catch {
      return '';
    }
  }

  _cleanupChild(runId) {
    this.children.delete(runId);
    const log = this.logs.get(runId);
    if (log) {
      try {
        log.end();
      } catch {}
      this.logs.delete(runId);
    }
  }

  snapshot() {
    const runs = this.activeRuns().map((r) => {
      const agent = this.get(r.agentId);
      const reports = this.data.reports.filter((x) => x.runId === r.id).slice(-5);
      return {
        runId: r.id,
        agent: agent?.name || r.agentName,
        title: r.title,
        status: r.status,
        progress: r.progress,
        needsAttention: r.needsAttention,
        attentionReason: r.attentionReason,
        startedAt: new Date(r.startedAt).toISOString(),
        lastReportAt: new Date(r.lastReportAt).toISOString(),
        checkInMinutes: r.checkInMinutes,
        summary: truncate(r.summary, 300),
        recent: reports.map((x) => ({ at: new Date(x.at).toISOString(), message: truncate(x.message, 200), level: x.level })),
      };
    });
    const recentDone = this.data.runs
      .filter((r) => r.endedAt && Date.now() - r.endedAt < 24 * 3600 * 1000)
      .slice(0, 8)
      .map((r) => ({
        runId: r.id,
        agent: r.agentName,
        title: r.title,
        status: r.status,
        endedAt: new Date(r.endedAt).toISOString(),
        summary: truncate(r.summary, 220),
      }));
    return { active: runs, recentDone };
  }

  summaryText() {
    const active = this.activeRuns();
    if (!active.length) return '当前没有进行中的智能体任务。';
    return active
      .map((r) => {
        const a = this.get(r.agentId);
        return `· ${a?.name || r.agentName}：${STATUS_TEXT[r.status] || r.status}，${r.progress}%，${truncate(r.title, 40)}`;
      })
      .join('\n');
  }

  promptSummary() {
    return this.list()
      .slice(0, 8)
      .map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        status: a.currentRun?.status || 'idle',
        progress: a.currentRun?.progress ?? null,
        title: a.currentRun?.title || '',
        needsAttention: a.currentRun?.needsAttention || false,
      }));
  }

  shutdown() {
    this._shutdown = true;
    for (const [, child] of this.children) {
      try {
        child.kill();
      } catch {}
    }
    for (const [, log] of this.logs) {
      try {
        log.end();
      } catch {}
    }
    this.children.clear();
    this.logs.clear();
  }
}

module.exports = { AgentService, ACTIVE_STATUS, FINAL_STATUS, STATUS_TEXT, ATTENTION_RE };
