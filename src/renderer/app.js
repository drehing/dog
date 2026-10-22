const api = window.dog;

const state = {
  data: null,
  view: 'home',
  taskFilter: 'today',
  chatBusy: false,
  chatDraft: '',
  toolStatus: '',
  chatError: '',
  expandedInbox: null,
  runDetail: null,
  runTab: 'reports',
  providerTestResult: '',
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const STATUS = {
  queued: { text: '排队中', chip: 'chip-amber' },
  running: { text: '进行中', chip: 'chip-green' },
  waiting: { text: '等待中', chip: 'chip-amber' },
  blocked: { text: '被卡住', chip: 'chip-red' },
  done: { text: '已完成', chip: 'chip-green' },
  failed: { text: '失败', chip: 'chip-red' },
  cancelled: { text: '已取消', chip: '' },
};

const KIND_META = {
  briefing: { icon: '🌅', label: '早报' },
  review: { icon: '🌙', label: '收尾' },
  supervision: { icon: '👀', label: '监工' },
  completion: { icon: '✅', label: '完成' },
  failure: { icon: '⚠️', label: '失败' },
  attention: { icon: '⚠️', label: '待确认' },
  reminder: { icon: '⏰', label: '提醒' },
  system: { icon: '🐕', label: '秘书' },
};

const AGENT_KIND = { internal: '内部', cli: '命令行', http: '接口' };

const TOOL_LABEL = {
  today_overview: '查看今日',
  list_tasks: '查看待办',
  create_task: '记下事项',
  update_task: '更新事项',
  complete_task: '完成事项',
  delete_task: '删除事项',
  get_now: '查看时间',
  list_agents: '查看智能体',
  start_agent_run: '派活',
  get_agent_status: '查询进度',
  send_agent_instruction: '传达指令',
  cancel_agent_run: '取消任务',
  notify_user: '发送提醒',
  save_note: '记笔记',
  search_everything: '搜索',
};

boot();

async function boot() {
  try {
    const data = await api.call('app:bootstrap');
    state.data = data;
    applyChrome();
    if (!data.meta.onboarded) {
      renderOnboarding();
      return;
    }
    renderView();
  } catch (err) {
    $('#view').innerHTML = `<div class="empty"><div class="icon">🐕</div><b>启动失败</b><p>${esc(err.message)}</p></div>`;
  }
}

function applyChrome() {
  if (!state.data) return;
  const r = state.data.runtime;
  const name = r.isMock ? '演示模式' : r.providerName || r.modelName || '未配置';
  $('#model-name').textContent = name;
  $('#model-dot').classList.toggle('live', !r.isMock);

  const unread = state.data.inbox.filter((i) => !i.read).length;
  const attention = state.data.agents.filter((a) => a.currentRun?.needsAttention).length;
  const runCount = state.data.agents.filter((a) => a.currentRun).length;
  const bi = $('#badge-inbox');
  const ba = $('#badge-agents');
  bi.textContent = unread > 99 ? '99+' : unread || '';
  ba.textContent = attention ? String(attention) : '';
  ba.style.background = attention ? 'var(--red)' : 'var(--amber)';

  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.view));
  document.title = unread ? `Dog 秘书 · ${unread} 条未读` : 'Dog 秘书';
}

/* ------------------------------------------------------------------ */
/* 渲染入口                                                             */
/* ------------------------------------------------------------------ */

function renderView() {
  if (!state.data) return;
  const view = $('#view');
  const prevScroll = view.scrollTop;
  view.className = 'view' + (state.view === 'chat' ? ' chat-view' : '');
  switch (state.view) {
    case 'home':
      view.innerHTML = viewHome();
      break;
    case 'tasks':
      view.innerHTML = viewTasks();
      break;
    case 'agents':
      view.innerHTML = viewAgents();
      break;
    case 'inbox':
      view.innerHTML = viewInbox();
      break;
    case 'chat':
      view.innerHTML = viewChat();
      afterChatRender();
      break;
    case 'settings':
      view.innerHTML = viewSettings();
      break;
    default:
      view.innerHTML = viewHome();
  }
  view.scrollTop = prevScroll;
}

function switchView(name) {
  if (!['home', 'tasks', 'agents', 'inbox', 'chat', 'settings'].includes(name)) return;
  state.view = name;
  if (name === 'chat') {
    state.chatDraft = '';
    state.chatError = '';
  }
  closeOverlay();
  applyChrome();
  renderView();
  $('#view').scrollTop = 0;
  if (name === 'chat') setTimeout(() => $('#chat-input')?.focus(), 50);
}

/* ------------------------------------------------------------------ */
/* 今日                                                                 */
/* ------------------------------------------------------------------ */

function viewHome() {
  const d = state.data;
  const r = d.runtime;
  const s = d.overview.stats || {};
  const name = d.settings.userName || '';
  const hour = new Date().getHours();
  const hello = hour < 5 ? '夜深了' : hour < 9 ? '早上好' : hour < 12 ? '上午好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  const dateText = `${new Date().getMonth() + 1}月${new Date().getDate()}日 周${'日一二三四五六'[new Date().getDay()]}`;
  const today = homeTasks();
  const undated = d.tasks.filter((t) => t.status === 'todo' && !t.dueAt).slice(0, 6);
  const watch = d.agents.filter((a) => a.currentRun).slice(0, 3);
  const idle = d.agents.filter((a) => !a.currentRun).slice(0, 3);
  const recent = d.inbox.slice(0, 3);

  return `
    <div class="greeting">
      <div>
        <h1>${esc(hello)}${name ? `，${esc(name)}` : ''}</h1>
        <div class="date">${esc(dateText)} · 我是${esc(d.settings.assistantName || '阿犬')}</div>
      </div>
      <div class="avatar-orb">🐕</div>
    </div>
    ${
      r.isMock
        ? `<div class="banner">${icon('spark')}<span>演示模式：不调用真实模型。填入 API Key 后我就能真正干活。</span><button data-action="nav:settings">去配置</button></div>`
        : ''
    }
    <div class="hero">
      <div class="hero-top">
        <span class="hero-label">TODAY</span>
        <button class="btn btn-sm" data-action="settings:briefing">${icon('spark')} 让阿犬简报</button>
      </div>
      <div class="hero-stats">
        <div class="stat"><b>${s.todayCount ?? 0}</b><span>今天</span></div>
        <div class="stat ${s.overdueCount ? 'warn' : ''}"><b>${s.overdueCount ?? 0}</b><span>已过期</span></div>
        <div class="stat click" data-action="tasks:show-done" title="查看已完成事项"><b>${s.doneTodayCount ?? 0}</b><span>已完成</span></div>
      </div>
    </div>

    <form class="quick" id="quick-form">
      ${icon('plus')}
      <input id="quick-input" name="text" autocomplete="off" placeholder="记一件事，例如：明天下午3点交周报" maxlength="200" />
      <button type="submit" title="记下">${icon('right')}</button>
    </form>
    <div class="quick-hint">Enter 记下 · 我会自动识别时间并到点提醒你</div>

    <div class="section">
      <div class="section-head">
        <div class="section-title">今天要做 <span class="count">${today.length}</span></div>
        <button class="link-btn" data-action="task:new">+ 新事项</button>
      </div>
      ${
        today.length
          ? `<div class="task-list">${today.slice(0, 5).map((t) => taskRow(t)).join('')}</div>`
          : emptyBlock('🌤️', '今天没有硬性安排', '想到什么就记一笔，或者让我帮你排个计划。')
      }
    </div>

    ${
      undated.length
        ? `<div class="section">
            <div class="section-head">
              <div class="section-title">待办 <span class="count">${undated.length}</span></div>
              <button class="link-btn" data-action="tasks:show-active">全部待办 →</button>
            </div>
            <div class="task-list">${undated.map((t) => taskRow(t)).join('')}</div>
          </div>`
        : ''
    }

    <div class="section">
      <div class="section-head">
        <div class="section-title">智能体 <span class="count">${watch.length ? `${watch.length} 个在跑` : idle.length ? `${idle.length} 个待命` : ''}</span></div>
        <button class="link-btn" data-action="nav:agents">监工台 →</button>
      </div>
      ${
        watch.length
          ? `<div class="panel">${watch
              .map(
                (a) => `<div class="row click" data-action="agent:detail" data-id="${a.currentRun.id}">
                  <div class="agent-avatar ${a.color || ''}" style="width:26px;height:26px;border-radius:8px;font-size:11px">${esc(a.name.slice(0, 1))}</div>
                  <div class="grow">
                    <div class="label">${esc(a.name)} <span class="chip ${a.currentRun.needsAttention ? 'chip-red' : 'chip-green'}" style="margin-left:4px">${a.currentRun.needsAttention ? '需要你' : STATUS[a.currentRun.status]?.text || a.currentRun.status}</span></div>
                    <div class="desc">${esc(a.currentRun.title)}</div>
                  </div>
                  <div class="value">${a.currentRun.progress || 0}%</div>
                </div>`
              )
              .join('')}</div>`
          : idle.length
            ? `<div class="panel"><div class="row">
                <div class="grow"><div class="label">${idle.map((a) => esc(a.name)).join('、')} 待命</div><div class="desc">派个活，我会替你把进度盯住。</div></div>
                <button class="btn btn-sm" data-action="agent:start" data-id="${idle[0].id}">派活</button>
              </div></div>`
            : `<div class="panel"><div class="row"><div class="grow"><div class="label">没有正在跑的智能体</div><div class="desc">把活派给智能体，我会替你盯着进度、汇总结果。</div></div><button class="btn btn-sm" data-action="agent:new">添加</button></div></div>`
      }
    </div>

    <div class="section">
      <div class="section-head">
        <div class="section-title">最近消息</div>
        <button class="link-btn" data-action="nav:inbox">收件箱 →</button>
      </div>
      ${
        recent.length
          ? `<div class="inbox-list">${recent.map((i) => inboxItem(i, true)).join('')}</div>`
          : emptyBlock('📭', '还没有消息', '提醒、早报和监工汇总都会出现在这里。')
      }
    </div>
  `;
}

function homeTasks() {
  const now = Date.now();
  const eod = new Date();
  eod.setHours(23, 59, 59, 999);
  return state.data.tasks
    .filter((t) => ['todo', 'doing'].includes(t.status) && ((t.dueAt && t.dueAt <= eod.getTime()) || t.status === 'doing'))
    .sort((a, b) => (a.dueAt || Infinity) - (b.dueAt || Infinity));
}

function taskRow(t) {
  const done = t.status === 'done';
  const overdue = !done && t.dueAt && t.dueAt < Date.now();
  const due = t.dueAt ? fmtDue(t.dueAt) : '';
  const tags = (t.tags || []).slice(0, 3).map((x) => `<span class="tag">${esc(x)}</span>`).join('');
  return `
    <div class="task ${done ? 'done' : ''}" data-action="task:edit" data-id="${t.id}">
      <button class="check ${done ? 'on' : ''}" data-action="task:toggle" data-id="${t.id}" title="${done ? '重新打开' : '标记完成'}">${icon('check')}</button>
      <div class="task-main">
        <div class="task-title">${esc(t.title)}</div>
        <div class="task-meta">
          ${t.priority >= 2 ? `<span class="prio p${t.priority}"></span>` : ''}
          ${
            done
              ? t.completedAt
                ? `<span class="due">${icon('check')}完成于 ${esc(fmtDue(new Date(t.completedAt).getTime()))}</span>`
                : '<span>已完成</span>'
              : due
                ? `<span class="due ${overdue ? 'overdue' : ''}">${icon('clock')}${esc(due)}</span>`
                : '<span>无时间</span>'
          }
          ${tags}
        </div>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* 任务                                                                 */
/* ------------------------------------------------------------------ */

function viewTasks() {
  const d = state.data;
  const filter = state.taskFilter;
  let items = d.tasks.slice();
  if (filter === 'today') {
    const eod = new Date();
    eod.setHours(23, 59, 59, 999);
    items = items.filter((t) => ['todo', 'doing'].includes(t.status) && ((t.dueAt && t.dueAt <= eod.getTime()) || t.status === 'doing'));
  } else if (filter === 'active') items = items.filter((t) => ['todo', 'doing'].includes(t.status));
  else if (filter === 'done') items = items.filter((t) => t.status === 'done');
  items.sort((a, b) => {
    if (filter === 'done') return String(b.completedAt || '').localeCompare(String(a.completedAt || ''));
    return (a.dueAt || Infinity) - (b.dueAt || Infinity);
  });
  const counts = {
    today: d.tasks.filter((t) => ['todo', 'doing'].includes(t.status) && t.dueAt && t.dueAt <= endToday()).length,
    active: d.tasks.filter((t) => ['todo', 'doing'].includes(t.status)).length,
    done: d.tasks.filter((t) => t.status === 'done').length,
  };
  const recentDone = d.tasks
    .filter((t) => t.status === 'done')
    .sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')))
    .slice(0, 5);
  return `
    <div class="page-head">
      <div><h1>事项</h1><div class="sub">${counts.active} 项待办 · 今天 ${counts.today} 项 · 已完成 ${counts.done} 项</div></div>
      <div class="head-actions"><button class="btn btn-primary" data-action="task:new">${icon('plus')}新事项</button></div>
    </div>
    <div class="filter-row">
      <button class="filter ${filter === 'today' ? 'active' : ''}" data-action="task:filter" data-filter="today">今天</button>
      <button class="filter ${filter === 'active' ? 'active' : ''}" data-action="task:filter" data-filter="active">待办</button>
      <button class="filter ${filter === 'done' ? 'active' : ''}" data-action="task:filter" data-filter="done">已完成 ${counts.done}</button>
      <button class="filter ${filter === 'all' ? 'active' : ''}" data-action="task:filter" data-filter="all">全部</button>
    </div>
    ${
      items.length
        ? `<div class="task-list">${items.map((t) => taskRow(t)).join('')}</div>`
        : emptyBlock('📝', filter === 'done' ? '还没有完成的事项' : filter === 'active' ? '没有未完成的待办' : '这里空着', '记下第一件事，我会替你盯着时间。')
    }
    ${
      filter !== 'done' && filter !== 'all' && recentDone.length
        ? `<div class="section">
            <div class="section-head"><div class="section-title">最近完成 <span class="count">${recentDone.length}</span></div><button class="link-btn" data-action="task:filter" data-filter="done">查看全部 →</button></div>
            <div class="task-list">${recentDone.map((t) => taskRow(t)).join('')}</div>
          </div>`
        : ''
    }
  `;
}

function endToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function openTaskSheet(id = null) {
  const task = id ? state.data.tasks.find((t) => t.id === id) : null;
  const dueValue = task ? (task.dueAt ? localInput(task.dueAt) : '') : localInput(nextHour());
  const priority = task?.priority ?? 1;
  const hasRemind = task ? Boolean(task.remindAt) : true;
  const done = task?.status === 'done';
  const body = `
    <form id="task-form" data-id="${task?.id || ''}">
      <div class="field">
        <label>事项</label>
        <input class="input" name="title" maxlength="200" required value="${esc(task?.title || '')}" placeholder="要做什么？" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>时间</label>
          <input class="input" type="datetime-local" name="dueAt" value="${dueValue}" />
        </div>
        <div class="field">
          <label>优先级</label>
          <div class="seg" id="task-prios">
            ${[0, 1, 2, 3]
              .map(
                (p) => `<button type="button" class="${priority === p ? 'active' : ''} ${p === 3 ? 'p3' : ''}" data-action="task:prio" data-prio="${p}">${['低', '普通', '重要', '紧急'][p]}</button>`
              )
              .join('')}
          </div>
          <input type="hidden" name="priority" value="${priority}" />
        </div>
      </div>
      <div class="field">
        <label>备注（可选）</label>
        <textarea class="textarea" name="notes" maxlength="4000" placeholder="补充背景、链接或标准">${esc(task?.notes || '')}</textarea>
      </div>
      <label class="checkbox" style="margin-top:2px">
        <input type="checkbox" name="remind" ${hasRemind ? 'checked' : ''} />
        <span>到点提醒我（桌面悬浮通知）</span>
      </label>
      <div class="form-error hidden" id="task-error"></div>
    </form>`;
  const footer = `
    ${task ? `<button class="btn btn-danger btn-sm" data-action="task:delete" data-id="${task.id}">${icon('trash')}删除</button>` : ''}
    ${done ? `<button class="btn btn-sm" data-action="task:reopen" data-id="${task.id}">重新打开</button>` : ''}
    <div class="spacer"></div>
    <button class="btn" data-action="modal:close">取消</button>
    <button class="btn btn-primary" data-action="task:save">${task ? '保存' : '记下'}</button>`;
  openSheet({ title: task ? '编辑事项' : '新事项', body, footer });
}

async function saveTask() {
  const form = $('#task-form');
  if (!form) return;
  const id = form.dataset.id;
  const fd = new FormData(form);
  const title = String(fd.get('title') || '').trim();
  const err = $('#task-error');
  if (!title) {
    showFormError(err, '写点内容再保存');
    return;
  }
  const dueRaw = String(fd.get('dueAt') || '');
  const dueAt = dueRaw ? new Date(dueRaw).getTime() : null;
  const remind = fd.get('remind') === 'on' && dueAt != null;
  const lead = Number(state.data.settings.schedule.reminderLeadMinutes) || 0;
  const payload = {
    title,
    notes: String(fd.get('notes') || ''),
    priority: Number(fd.get('priority') || 1),
    dueAt,
    remindAt: remind ? dueAt - lead * 60000 : null,
    remind,
    tags: [],
  };
  const saved = await call(id ? 'tasks:update' : 'tasks:create', id ? { id, patch: payload } : payload);
  if (!saved) return;
  closeOverlay();
  await refresh();
  toast(id ? '已保存' : '记下了', 'ok');
}

/* ------------------------------------------------------------------ */
/* 智能体                                                               */
/* ------------------------------------------------------------------ */

function viewAgents() {
  const d = state.data;
  const agents = d.agents;
  const running = agents.filter((a) => a.currentRun).length;
  const attention = agents.filter((a) => a.currentRun?.needsAttention).length;
  const finished = d.runs.filter((r) => r.endedAt).slice(0, 6);
  return `
    <div class="page-head">
      <div><h1>监工台</h1><div class="sub">${running} 个进行中${attention ? ` · ${attention} 个需要你` : ' · 都还正常'}</div></div>
      <div class="head-actions">
        <button class="icon-btn" data-action="agent:summary" title="立即汇总">${icon('refresh')}</button>
        <button class="btn btn-primary" data-action="agent:new">${icon('plus')}添加</button>
      </div>
    </div>
    ${
      agents.length
        ? `<div class="agent-list">${agents.map((a) => agentCard(a)).join('')}</div>`
        : emptyBlock('🤖', '还没有纳管智能体', '添加一个内部助理，或接入你正在用的 CLI / 外部 Agent。')
    }
    ${
      finished.length
        ? `<div class="section">
            <div class="section-head"><div class="section-title">最近的活 <span class="count">${finished.length}</span></div></div>
            <div class="panel">${finished
              .map(
                (r) => `<div class="row click" data-action="agent:detail" data-id="${r.id}">
                  <div class="grow">
                    <div class="label">${esc(r.agentName)} · ${esc(r.title)}</div>
                    <div class="desc">${esc((r.summary || '').replace(/\s+/g, ' ').slice(0, 56) || '无摘要')}</div>
                  </div>
                  <span class="chip ${STATUS[r.status]?.chip || ''}">${STATUS[r.status]?.text || r.status}</span>
                  <span class="value" style="width:52px;text-align:right">${fmtAgo(r.endedAt)}</span>
                </div>`
              )
              .join('')}</div>
          </div>`
        : ''
    }
    <div class="section">
      <div class="panel">
        <div class="row">
          <div class="grow">
            <div class="label">监工规则</div>
            <div class="desc">每 ${d.settings.schedule.supervision.intervalMinutes} 分钟汇总一次；卡住、需要确认或完成时，会立即悬浮通知你。</div>
          </div>
          <button class="btn btn-sm" data-action="nav:settings">调整</button>
        </div>
      </div>
    </div>
  `;
}

function agentCard(a) {
  const run = a.currentRun;
  const last = a.lastRun;
  const attention = run?.needsAttention;
  const st = run ? STATUS[run.status] || { text: run.status, chip: '' } : null;
  const progress = run ? Math.min(100, Math.max(0, run.progress || 0)) : 0;
  const progClass = run?.status === 'failed' || run?.status === 'blocked' ? 'red' : run?.status === 'done' ? 'green' : '';
  return `
    <div class="agent-card ${attention ? 'attention' : ''}">
      <div class="agent-head">
        <div class="agent-avatar ${a.color || ''}">${esc((a.name || 'A').slice(0, 1))}</div>
        <div class="agent-ident">
          <div class="agent-name">${esc(a.name)} <span class="chip" style="font-size:9px;height:17px">${AGENT_KIND[a.kind] || a.kind}</span></div>
          <div class="agent-desc">${esc(a.description || '暂无描述')}</div>
        </div>
        ${run ? `<span class="chip ${st.chip}">${st.text}</span>` : '<span class="chip">待命</span>'}
      </div>
      ${
        run
          ? `<div class="agent-body">
              <div class="run-line"><span class="title">${esc(run.title)}</span><span>${progress}%</span></div>
              <div class="progress ${progClass}"><i style="width:${progress}%"></i></div>
              ${
                attention
                  ? `<div class="attention-note">⚠️ ${esc(run.attentionReason || '它停下来等你的指示')}</div>`
                  : `<div class="agent-foot"><span class="left">${esc(run.summary ? run.summary.slice(0, 70) : '正在推进…')}</span></div>`
              }
              <div class="agent-actions" style="margin-top:8px;justify-content:flex-end">
                <button class="btn btn-sm" data-action="agent:detail" data-id="${run.id}">详情</button>
                <button class="btn btn-sm btn-primary" data-action="agent:start" data-id="${a.id}">再派一活</button>
                <button class="icon-btn" data-action="agent:edit" data-id="${a.id}" title="编辑">${icon('edit')}</button>
              </div>
            </div>`
          : `<div class="agent-foot">
              <span class="left">${last ? `上次：${esc(last.title)} · ${STATUS[last.status]?.text || last.status}` : '还没有派过活'}</span>
              <div class="agent-actions">
                <button class="btn btn-sm" data-action="agent:edit" data-id="${a.id}">${icon('edit')}编辑</button>
                <button class="btn btn-sm btn-primary" data-action="agent:start" data-id="${a.id}">${icon('play')}派活</button>
              </div>
            </div>`
      }
    </div>`;
}

function openAgentSheet(id = null) {
  const a = id ? state.data.agents.find((x) => x.id === id) : null;
  const kind = a?.kind || 'internal';
  const body = `
    <form id="agent-form" data-id="${a?.id || ''}">
      <div class="field-row">
        <div class="field">
          <label>名字</label>
          <input class="input" name="name" maxlength="60" required value="${esc(a?.name || '')}" placeholder="例如：研究助理" />
        </div>
        <div class="field">
          <label>类型</label>
          <select class="select" name="kind" data-agent-kind>
            <option value="internal" ${kind === 'internal' ? 'selected' : ''}>内部助理（用当前模型）</option>
            <option value="cli" ${kind === 'cli' ? 'selected' : ''}>命令行 Agent</option>
            <option value="http" ${kind === 'http' ? 'selected' : ''}>外部接口 Agent</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label>一句话描述</label>
        <input class="input" name="description" maxlength="500" value="${esc(a?.description || '')}" placeholder="它擅长做什么" />
      </div>
      <div data-kind-panel="internal" class="field ${kind === 'internal' ? '' : 'hidden'}">
        <label>角色设定</label>
        <textarea class="textarea" name="systemPrompt" maxlength="4000" placeholder="你是一名…">${esc(a?.systemPrompt || '')}</textarea>
      </div>
      <div data-kind-panel="cli" class="${kind === 'cli' ? '' : 'hidden'}">
        <div class="field">
          <label>可执行命令</label>
          <input class="input" name="command" value="${esc(a?.command || '')}" placeholder="例如：claude 或 codex" />
        </div>
        <div class="field">
          <label>参数模板</label>
          <input class="input" name="argsTemplate" value="${esc(a?.argsTemplate || '{prompt}')}" placeholder="例如：-p {prompt}" />
          <div class="form-note">用 <code>{prompt}</code> 代表任务内容；也可选从 stdin 传入。</div>
        </div>
        <div class="field-row">
          <div class="field"><label>工作目录（可选）</label><input class="input" name="cwd" value="${esc(a?.cwd || '')}" placeholder="D:\\Projects\\demo" /></div>
          <div class="field">
            <label>任务传入方式</label>
            <select class="select" name="promptVia">
              <option value="arg" ${a?.promptVia !== 'stdin' && a?.promptVia !== 'env' ? 'selected' : ''}>参数</option>
              <option value="stdin" ${a?.promptVia === 'stdin' ? 'selected' : ''}>标准输入</option>
              <option value="env" ${a?.promptVia === 'env' ? 'selected' : ''}>环境变量</option>
            </select>
          </div>
        </div>
        <div class="form-note">启动时会注入 DOG_RUN_ID / DOG_REPORT_URL / DOG_TOKEN，Agent 可以主动汇报进度。</div>
      </div>
      <div data-kind-panel="http" class="${kind === 'http' ? '' : 'hidden'}">
        <div class="field">
          <label>派活地址（可选）</label>
          <input class="input" name="dispatchUrl" value="${esc(a?.dispatchUrl || '')}" placeholder="https://your-agent.local/dispatch" />
          <div class="form-note">留空则只登记任务，等外部 Agent 通过本地 /v1/report 接口上报。</div>
        </div>
      </div>
      <div class="field">
        <label>多久没汇报算“失联”</label>
        <select class="select" name="checkInMinutes">
          ${[10, 15, 30, 45, 60, 120]
            .map((m) => `<option value="${m}" ${Number(a?.checkInMinutes || 30) === m ? 'selected' : ''}>${m} 分钟</option>`)
            .join('')}
        </select>
      </div>
      <div class="form-error hidden" id="agent-error"></div>
    </form>`;
  const footer = `
    ${a ? `<button class="btn btn-danger btn-sm" data-action="agent:delete" data-id="${a.id}">${icon('trash')}删除</button>` : ''}
    <div class="spacer"></div>
    <button class="btn" data-action="modal:close">取消</button>
    <button class="btn btn-primary" data-action="agent:save">${a ? '保存' : '添加'}</button>`;
  openSheet({ title: a ? '编辑智能体' : '添加智能体', body, footer });
}

async function saveAgent() {
  const form = $('#agent-form');
  if (!form) return;
  const fd = new FormData(form);
  const name = String(fd.get('name') || '').trim();
  if (!name) {
    showFormError($('#agent-error'), '给它起个名字');
    return;
  }
  const kind = String(fd.get('kind') || 'internal');
  const payload = {
    name,
    kind,
    description: String(fd.get('description') || ''),
    systemPrompt: String(fd.get('systemPrompt') || ''),
    command: String(fd.get('command') || ''),
    argsTemplate: String(fd.get('argsTemplate') || '{prompt}'),
    cwd: String(fd.get('cwd') || ''),
    promptVia: String(fd.get('promptVia') || 'arg'),
    dispatchUrl: String(fd.get('dispatchUrl') || ''),
    checkInMinutes: Number(fd.get('checkInMinutes') || 30),
  };
  const id = form.dataset.id;
  if (kind === 'cli' && !payload.command.trim()) {
    showFormError($('#agent-error'), '命令行 Agent 需要填写可执行命令');
    return;
  }
  const view = await call(id ? 'agents:update' : 'agents:create', id ? { id, patch: payload } : payload);
  if (!view) return;
  closeOverlay();
  await refresh();
  toast(id ? '已保存' : '智能体已添加', 'ok');
}

function openStartSheet(agentId = null) {
  const agents = state.data.agents;
  if (!agents.length) {
    openAgentSheet();
    return;
  }
  const activeTasks = state.data.tasks.filter((t) => ['todo', 'doing'].includes(t.status)).slice(0, 30);
  const options = agents
    .map((a) => `<option value="${a.id}" ${a.id === agentId ? 'selected' : ''}>${esc(a.name)} · ${AGENT_KIND[a.kind]}</option>`)
    .join('');
  const body = `
    <form id="start-form">
      <div class="field">
        <label>派给谁</label>
        <select class="select" name="agentId">${options}</select>
      </div>
      <div class="field">
        <label>任务说明</label>
        <textarea class="textarea" name="prompt" rows="5" required placeholder="把目标、范围、交付格式写清楚，它干活会更靠谱。"></textarea>
      </div>
      <div class="field">
        <label>短标题（可选）</label>
        <input class="input" name="title" maxlength="120" placeholder="不填就取任务说明的开头" />
      </div>
      <div class="field">
        <label>关联事项（可选）</label>
        <select class="select" name="taskId">
          <option value="">不关联</option>
          ${activeTasks.map((t) => `<option value="${t.id}">${esc(t.title)}</option>`).join('')}
        </select>
      </div>
      <div class="form-note">派出去后我会定期汇总进度；它需要你拍板或完成时，会发悬浮通知。</div>
      <div class="form-error hidden" id="start-error"></div>
    </form>`;
  const footer = `<button class="btn" data-action="modal:close">取消</button><button class="btn btn-primary" data-action="agent:dispatch">派活</button>`;
  openSheet({ title: '派个活', body, footer });
}

async function dispatchAgent() {
  const form = $('#start-form');
  if (!form) return;
  const fd = new FormData(form);
  const prompt = String(fd.get('prompt') || '').trim();
  if (!prompt) {
    showFormError($('#start-error'), '先写清楚要它做什么');
    return;
  }
  const view = await call('agents:start', {
    agentId: String(fd.get('agentId') || ''),
    prompt,
    title: String(fd.get('title') || '').trim() || undefined,
    taskId: String(fd.get('taskId') || '') || null,
  });
  if (!view) return;
  closeOverlay();
  state.view = 'agents';
  await refresh();
  toast('已经派出去了，我会盯着', 'ok');
}

async function openRunSheet(runId) {
  if (!runId) return;
  try {
    const [run, log] = await Promise.all([
      api.call('agents:run', { runId }),
      api.call('agents:log', { runId }).catch(() => ''),
    ]);
    if (!run) return;
    state.runDetail = { run, log: log || '' };
    state.runTab = 'reports';
    renderRunSheet();
  } catch (err) {
    toast(err.message, 'err');
  }
}

function renderRunSheet() {
  const detail = state.runDetail;
  if (!detail) return;
  const run = detail.run;
  const st = STATUS[run.status] || { text: run.status, chip: '' };
  const active = ['queued', 'running', 'waiting', 'blocked'].includes(run.status);
  const progress = Math.min(100, Math.max(0, run.progress || 0));
  const progClass = run.status === 'failed' || run.status === 'blocked' ? 'red' : run.status === 'done' ? 'green' : '';
  const body = `
    <div class="agent-head" style="margin-bottom:10px">
      <div class="agent-avatar">${esc((run.agentName || 'A').slice(0, 1))}</div>
      <div class="agent-ident">
        <div class="agent-name">${esc(run.agentName)} <span class="chip ${st.chip}">${st.text}</span></div>
        <div class="agent-desc">${esc(run.title)}</div>
      </div>
      <div style="font-size:18px;font-weight:700">${progress}%</div>
    </div>
    <div class="progress ${progClass}" style="margin-bottom:12px"><i style="width:${progress}%"></i></div>
    ${run.needsAttention ? `<div class="attention-note" style="margin-bottom:10px">⚠️ ${esc(run.attentionReason || '它在等你')}</div>` : ''}
    <div class="field">
      <label>任务说明</label>
      <div class="run-summary">${esc(run.prompt || '')}</div>
    </div>
    ${
      run.summary
        ? `<div class="field"><label>最新成果</label><div class="run-summary">${esc(run.summary)}</div></div>`
        : ''
    }
    <div class="tabs-mini">
      <button class="${state.runTab === 'reports' ? 'active' : ''}" data-action="run:tab" data-tab="reports">汇报记录 · ${run.reports?.length || 0}</button>
      <button class="${state.runTab === 'log' ? 'active' : ''}" data-action="run:tab" data-tab="log">运行日志</button>
    </div>
    ${
      state.runTab === 'reports'
        ? `<div class="timeline">${
            (run.reports || [])
              .slice()
              .reverse()
              .map(
                (r) => `<div class="report ${r.level || ''}">
                  <span class="bullet"></span>
                  <div class="report-main">
                    <div class="report-msg">${esc(r.message || '')}</div>
                    <div class="report-meta">${fmtAgo(r.at)} · ${esc(STATUS[r.status]?.text || r.status || '')}${r.source === 'system' ? ' · 系统' : ''}</div>
                  </div>
                </div>`
              )
              .join('') || '<div class="empty"><b>还没有汇报</b><p>任务开始后，智能体的进度会出现在这里。</p></div>'
          }</div>`
        : `<pre class="log-box">${esc(detail.log || '（暂无日志。内部助理和接口型 Agent 不会产生命令行日志。）')}</pre>`
    }
    ${
      active
        ? `<form id="instruct-form" data-run="${run.id}" style="margin-top:12px">
            <div class="field" style="margin-bottom:6px"><label>补一句指令 / 回答它</label>
              <div style="display:flex;gap:6px"><input class="input" name="message" placeholder="例如：用更正式的语气" /><button type="submit" class="btn btn-sm">发送</button></div>
            </div>
          </form>`
        : ''
    }
  `;
  const footer = `
    ${run.needsAttention ? `<button class="btn btn-sm" data-action="agent:ack" data-id="${run.id}">知道了</button>` : ''}
    ${active ? `<button class="btn btn-sm btn-danger" data-action="agent:cancel" data-id="${run.id}">取消任务</button>` : ''}
    <div class="spacer"></div>
    <button class="btn" data-action="modal:close">关闭</button>
    <button class="btn btn-primary" data-action="run:refresh" data-id="${run.id}">${icon('refresh')}刷新</button>`;
  openSheet({ title: '任务详情', body, footer });
}

/* ------------------------------------------------------------------ */
/* 收件箱                                                               */
/* ------------------------------------------------------------------ */

function viewInbox() {
  const d = state.data;
  const unread = d.inbox.filter((i) => !i.read).length;
  return `
    <div class="page-head">
      <div><h1>收件箱</h1><div class="sub">${unread ? `${unread} 条未读` : '都看过了'} · 提醒与汇总都在这里</div></div>
      <div class="head-actions">
        <button class="icon-btn" data-action="inbox:read-all" title="全部已读">${icon('check')}</button>
        <button class="icon-btn" data-action="inbox:clear" title="清理已读">${icon('trash')}</button>
      </div>
    </div>
    ${
      d.inbox.length
        ? `<div class="inbox-list">${d.inbox.map((i) => inboxItem(i)).join('')}</div>`
        : emptyBlock('📭', '收件箱是空的', '到点提醒、早报、智能体完成与监工汇总都会送到这里。')
    }
  `;
}

function inboxItem(item, compact = false) {
  const meta = KIND_META[item.kind] || KIND_META.system;
  const expanded = state.expandedInbox === item.id;
  const unread = !item.read;
  const body = String(item.body || '');
  const preview = body.replace(/\s+/g, ' ').slice(0, compact ? 64 : 110);
  return `
    <div class="inbox-item ${unread ? 'unread' : ''}" data-action="inbox:expand" data-id="${item.id}">
      <div class="inbox-head">
        <span class="inbox-ico">${meta.icon}</span>
        <span class="inbox-title">${esc(item.title)}</span>
        ${unread ? '<i class="unread-dot"></i>' : ''}
        <span class="inbox-time">${fmtAgo(item.at)}</span>
      </div>
      <div class="inbox-preview">${esc(preview)}</div>
      ${expanded ? `<div class="inbox-body">${esc(body)}</div>` : ''}
      ${
        expanded
          ? `<div class="inbox-actions">
              ${item.meta?.runId ? `<button class="btn btn-sm" data-action="inbox:run" data-id="${item.meta.runId}">查看任务</button>` : ''}
              ${item.meta?.taskId ? `<button class="btn btn-sm" data-action="inbox:task" data-id="${item.meta.taskId}">打开事项</button>` : ''}
            </div>`
          : ''
      }
    </div>`;
}

/* ------------------------------------------------------------------ */
/* 对话                                                                 */
/* ------------------------------------------------------------------ */

function viewChat() {
  const d = state.data;
  const r = d.runtime;
  const msgs = d.chat || [];
  const status = state.chatBusy ? state.toolStatus || '阿犬正在想…' : '';
  const suggestions = ['今天怎么安排？', '提醒我明天下午3点交周报', '看看智能体进度', '帮我总结一下今天的进展'];
  return `
    <div class="chat-head">
      <div class="agent-avatar" style="width:29px;height:29px;border-radius:9px;font-size:14px">🐕</div>
      <div class="who"><b>${esc(d.settings.assistantName || '阿犬')}</b><span>${r.isMock ? '演示模式 · 不调用真实模型' : `${esc(r.providerName)} · ${esc(r.modelName)}`}</span></div>
      <button class="icon-btn" data-action="chat:clear" title="清空对话">${icon('trash')}</button>
    </div>
    <div class="messages" id="messages">
      ${
        msgs.length
          ? msgs.map((m) => chatMessage(m)).join('')
          : `<div class="empty-chat">
              <div class="orb">🐕</div>
              <b>我在，随时待命</b>
              <p>可以让我记事、排计划、查进度，<br/>或者替你盯一会儿智能体。</p>
            </div>`
      }
      ${state.chatError ? `<div class="msg assistant"><div class="msg-avatar">🐕</div><div class="bubble" style="border-color:rgba(239,122,109,.3);color:#ffb5ac">${esc(state.chatError)}</div></div>` : ''}
      ${state.chatBusy ? `<div class="msg assistant"><div class="msg-avatar">🐕</div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>` : ''}
    </div>
    <div class="suggestions" style="padding-left:14px;padding-right:14px">
      ${suggestions.map((s) => `<button class="suggest" data-action="chat:suggest" data-text="${esc(s)}">${esc(s)}</button>`).join('')}
    </div>
    <div class="composer-status" id="composer-status">${esc(status)}</div>
    <form class="composer" id="chat-form">
      <textarea id="chat-input" name="text" rows="1" maxlength="6000" placeholder="和${esc(d.settings.assistantName || '阿犬')}说点什么…"></textarea>
      <button class="send-btn" type="submit" ${state.chatBusy ? 'disabled' : ''} title="发送">${icon('send')}</button>
    </form>
  `;
}

function chatMessage(m) {
  const isUser = m.role === 'user';
  if (isUser) {
    return `<div class="msg user"><div class="msg-avatar">你</div><div class="bubble">${md(m.content)}</div></div>`;
  }
  const trace = (m.trace || [])
    .map((t) => `<span>${icon('check')}${esc(TOOL_LABEL[t.name] || t.name)}</span>`)
    .join('');
  return `<div class="msg assistant">
    <div class="msg-avatar">🐕</div>
    <div>
      <div class="bubble">${md(m.content)}</div>
      ${trace ? `<div class="trace">${trace}</div>` : ''}
    </div>
  </div>`;
}

function afterChatRender() {
  const box = $('#messages');
  if (box) box.scrollTop = box.scrollHeight;
  const input = $('#chat-input');
  if (input) {
    input.value = state.chatDraft || '';
    input.style.height = 'auto';
    input.style.height = Math.min(92, input.scrollHeight) + 'px';
    if (!state.chatBusy && state.view === 'chat') input.focus();
  }
}

async function sendChat(text) {
  const content = String(text || '').trim();
  if (!content || state.chatBusy) return;
  state.chatBusy = true;
  state.chatError = '';
  state.toolStatus = '阿犬正在想…';
  state.chatDraft = '';
  state.data.chat.push({ id: 'temp-' + Date.now(), role: 'user', content, at: Date.now() });
  renderView();
  try {
    await api.call('chat:send', { text: content });
    state.data = await api.call('app:bootstrap');
    state.chatBusy = false;
    state.toolStatus = '';
    applyChrome();
    renderView();
  } catch (err) {
    state.chatBusy = false;
    state.toolStatus = '';
    state.chatError = err.message;
    try {
      state.data = await api.call('app:bootstrap');
    } catch {}
    applyChrome();
    renderView();
  }
}

/* ------------------------------------------------------------------ */
/* 设置                                                                 */
/* ------------------------------------------------------------------ */

function viewSettings() {
  const d = state.data;
  const s = d.settings;
  const r = d.runtime;
  const apiInfo = r.agentApi || {};
  const muted = r.scheduler?.mutedUntil;
  const providers = s.providers;
  const curl = `curl -X POST ${apiInfo.url || 'http://127.0.0.1:47821'}/v1/report \\
  -H "Authorization: Bearer ${apiInfo.token || 'YOUR_TOKEN'}" \\
  -H "Content-Type: application/json" \\
  -d '{"runId":"...","status":"running","progress":50,"message":"已完成一半"}'`;
  return `
    <div class="page-head"><div><h1>设置</h1><div class="sub">模型、通知、监工和数据</div></div></div>

    <div class="settings-group">
      <h2>模型</h2>
      <div class="panel">
        ${providers.map((p) => providerCard(p)).join('')}
        <div class="row click" data-action="settings:add-provider">
          <div class="grow"><div class="label">添加模型</div><div class="desc">OpenAI 兼容接口 / Anthropic / 本地 Ollama</div></div>
          ${icon('plus')}
        </div>
      </div>
      <div class="form-note">API Key 用 Windows DPAPI 加密后保存在本机，渲染层读不到明文。${r.encryptionAvailable ? '' : ' 当前系统加密不可用，已退回本机混淆存储。'}</div>
    </div>

    <div class="settings-group">
      <h2>秘书</h2>
      <div class="panel">
        <form id="profile-form">
          <div class="row"><div class="grow"><div class="label">怎么称呼你</div></div><input class="input" style="width:150px" name="userName" maxlength="40" value="${esc(s.userName)}" placeholder="老板" /></div>
          <div class="row"><div class="grow"><div class="label">秘书名字</div></div><input class="input" style="width:150px" name="assistantName" maxlength="20" value="${esc(s.assistantName)}" /></div>
          <div class="row" style="display:block"><div class="label" style="margin-bottom:5px">说话风格</div><textarea class="textarea" name="persona" maxlength="2000" style="min-height:64px">${esc(s.persona)}</textarea></div>
          <div class="row" style="justify-content:flex-end"><button class="btn btn-sm btn-primary" type="submit">保存</button></div>
        </form>
      </div>
    </div>

    <div class="settings-group">
      <h2>通知</h2>
      <div class="panel">
        <div class="row"><div class="grow"><div class="label">桌面悬浮通知</div><div class="desc">右上角浮出，简单两行，点一下进收件箱</div></div>${switchEl('notify.floating', s.notify.floating)}</div>
        <div class="row"><div class="grow"><div class="label">同时使用 Windows 系统通知</div><div class="desc">可能被专注助手拦截</div></div>${switchEl('notify.native', s.notify.native)}</div>
        <div class="row"><div class="grow"><div class="label">提示音</div><div class="desc">提醒和紧急消息响一声</div></div>${switchEl('notify.sound', s.notify.sound)}</div>
        <div class="row"><div class="grow"><div class="label">停留时间</div></div>
          <select class="select" style="width:96px" data-setting="notify.durationSec" data-type="number">
            ${[5, 7, 9, 12, 15, 20].map((v) => `<option value="${v}" ${Number(s.notify.durationSec) === v ? 'selected' : ''}>${v} 秒</option>`).join('')}
          </select>
        </div>
        <div class="row"><div class="grow"><div class="label">免打扰时段</div><div class="desc">${s.notify.quietHours.enabled ? '这期间只进收件箱，不打扰你' : '关闭'}</div></div>${switchEl('notify.quietHours.enabled', s.notify.quietHours.enabled)}</div>
        ${
          s.notify.quietHours.enabled
            ? `<div class="row"><div class="grow"><div class="label">从 / 到</div></div>
                <input class="input" type="time" style="width:92px" data-setting="notify.quietHours.start" value="${esc(s.notify.quietHours.start)}" />
                <span class="value">至</span>
                <input class="input" type="time" style="width:92px" data-setting="notify.quietHours.end" value="${esc(s.notify.quietHours.end)}" />
              </div>`
            : ''
        }
        <div class="row"><div class="grow"><div class="label">预览悬浮通知</div><div class="desc">看看实际效果</div></div><button class="btn btn-sm" data-action="settings:test-toast">发一条</button></div>
        <div class="row"><div class="grow"><div class="label">${muted ? '已静音' : '免打扰'}</div><div class="desc">${muted ? `到 ${new Date(muted).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })} 恢复` : '临时静音所有悬浮通知'}</div></div>
          ${muted ? `<button class="btn btn-sm" data-action="settings:unmute">恢复</button>` : `<button class="btn btn-sm" data-action="settings:mute">静音 1 小时</button>`}
        </div>
      </div>
    </div>

    <div class="settings-group">
      <h2>日程</h2>
      <div class="panel">
        <div class="row"><div class="grow"><div class="label">每日早报</div><div class="desc">今天要做什么，阿犬先替你捋一遍</div></div>
          <input class="input" type="time" style="width:92px;margin-right:4px" data-setting="schedule.briefing.time" value="${esc(s.schedule.briefing.time)}" />
          ${switchEl('schedule.briefing.enabled', s.schedule.briefing.enabled)}
        </div>
        <div class="row"><div class="grow"><div class="label">晚间收尾</div><div class="desc">完成了什么，还剩什么</div></div>
          <input class="input" type="time" style="width:92px;margin-right:4px" data-setting="schedule.review.time" value="${esc(s.schedule.review.time)}" />
          ${switchEl('schedule.review.enabled', s.schedule.review.enabled)}
        </div>
        <div class="row"><div class="grow"><div class="label">监工汇总</div><div class="desc">有智能体在跑时，定期汇总并通知</div></div>
          <select class="select" style="width:92px" data-setting="schedule.supervision.intervalMinutes" data-type="number">
            ${[30, 45, 60, 90, 120].map((v) => `<option value="${v}" ${Number(s.schedule.supervision.intervalMinutes) === v ? 'selected' : ''}>${v} 分钟</option>`).join('')}
          </select>
        </div>
        <div class="row"><div class="grow"><div class="label">提前提醒</div><div class="desc">事项到点前多久提醒</div></div>
          <select class="select" style="width:92px" data-setting="schedule.reminderLeadMinutes" data-type="number">
            ${[0, 5, 10, 15, 30, 60].map((v) => `<option value="${v}" ${Number(s.schedule.reminderLeadMinutes) === v ? 'selected' : ''}>${v ? v + ' 分钟' : '准时'}</option>`).join('')}
          </select>
        </div>
        <div class="row"><div class="grow"><div class="label">自动播报监工汇总</div><div class="desc">关闭后仍会写进收件箱，但不弹悬浮通知</div></div>${switchEl('supervisor.autoNotify', s.supervisor.autoNotify)}</div>
        <div class="row"><div class="grow"><div class="label">只在需要我时打扰</div><div class="desc">一切正常就安静，卡住或要你拍板才通知</div></div>${switchEl('supervisor.onlyWhenAttention', s.supervisor.onlyWhenAttention)}</div>
      </div>
    </div>

    <div class="settings-group">
      <h2>智能体接口</h2>
      <div class="panel">
        <div class="row"><div class="grow"><div class="label">本地接收器 ${apiInfo.running ? '<span class="chip chip-green" style="margin-left:4px">运行中</span>' : '<span class="chip chip-red" style="margin-left:4px">未运行</span>'}</div><div class="desc">${apiInfo.error ? esc(apiInfo.error) : `只监听 127.0.0.1:${apiInfo.port || s.agentApi.port}`}</div></div>${switchEl('agentApi.enabled', s.agentApi.enabled)}</div>
        <div class="row" style="display:block"><div class="label" style="margin-bottom:5px">上报地址</div>
          <div class="code-box"><code>${esc(apiInfo.url || '未启动')}</code><button data-action="settings:copy" data-copy="${esc(apiInfo.url || '')}" title="复制">${icon('copy')}</button></div>
        </div>
        <div class="row" style="display:block"><div class="label" style="margin-bottom:5px">Token</div>
          <div class="code-box"><code>${esc(apiInfo.token || '')}</code><button data-action="settings:copy" data-copy="${esc(apiInfo.token || '')}" title="复制">${icon('copy')}</button></div>
        </div>
        <div class="row" style="display:block">
          <div class="label" style="margin-bottom:5px">Agent 上报示例</div>
          <pre class="curl">${esc(curl)}</pre>
        </div>
        <div class="row"><div class="grow"><div class="label">维护</div><div class="desc">改了端口后重启；Token 泄露了就换一个</div></div>
          <button class="btn btn-sm" data-action="settings:restart-api">重启</button>
          <button class="btn btn-sm" data-action="settings:rotate-token">换 Token</button>
        </div>
      </div>
    </div>

    <div class="settings-group">
      <h2>启动与窗口</h2>
      <div class="panel">
        <div class="row"><div class="grow"><div class="label">开机自启</div><div class="desc">${r.isPackaged ? '登录 Windows 后在托盘静默运行' : '开发模式不可用，打包后生效'}</div></div>
          <label class="switch"><input type="checkbox" data-action="settings:login" ${s.launchAtLogin ? 'checked' : ''} ${r.isPackaged ? '' : 'disabled'} /><i></i></label>
        </div>
        <div class="row"><div class="grow"><div class="label">关闭时收起到托盘</div><div class="desc">继续盯提醒和智能体</div></div>${switchEl('closeToTray', s.closeToTray)}</div>
        <div class="row"><div class="grow"><div class="label">全局快捷键</div><div class="desc">随时叫我出来记东西</div></div><span class="chip">${esc(s.hotkey)}</span></div>
      </div>
    </div>

    <div class="settings-group">
      <h2>数据</h2>
      <div class="panel">
        <div class="row click" data-action="settings:open-data"><div class="grow"><div class="label">打开数据目录</div><div class="desc">data.json、日志与自动备份</div></div>${icon('folder')}</div>
        <div class="row click" data-action="settings:export"><div class="grow"><div class="label">导出备份</div><div class="desc">保存一份 JSON 快照</div></div>${icon('download')}</div>
        <div class="row click" data-action="settings:reset"><div class="grow"><div class="label" style="color:#ffa79d">清空并重新开始</div><div class="desc">会先自动备份，再重置所有数据</div></div>${icon('alert')}</div>
      </div>
    </div>

    <div class="settings-group">
      <h2>关于</h2>
      <div class="panel">
        <div class="row"><div class="grow"><div class="label">Dog 秘书 v${esc(r.appVersion)}</div><div class="desc">桌面 AI 秘书 · 记事 / 监工 / 汇总 / 悬浮通知</div></div><span style="font-size:20px">🐕</span></div>
        ${
          r.dataDirFallback
            ? `<div class="row"><div class="grow"><div class="label" style="color:#e8b46a">数据目录兼容模式</div><div class="desc">系统拒绝写入 AppData，已自动改用当前可写目录。设置环境变量 DOG_DATA_DIR 可指定固定位置。</div></div></div>`
            : ''
        }
        <div class="row"><div class="grow"><div class="label">数据目录</div><div class="desc" style="word-break:break-all">${esc(r.dataDir)}</div></div></div>
        <div class="row click" data-action="app:quit"><div class="grow"><div class="label" style="color:#ffa79d">退出 Dog</div><div class="desc">停止监工与提醒；数据会保留</div></div>${icon('x')}</div>
      </div>
    </div>
  `;
}

function providerCard(p) {
  const active = state.data.settings.activeProviderId === p.id;
  const test = p.lastTestAt ? (p.lastTestOk ? '连接正常' : '上次测试失败') : '';
  return `<div class="provider-card ${active ? 'active' : ''}">
    <div class="provider-head">
      <div class="agent-avatar" style="width:28px;height:28px;border-radius:8px;font-size:11px">${p.kind === 'mock' ? '🧪' : p.kind === 'anthropic' ? 'A' : 'AI'}</div>
      <div style="flex:1;min-width:0">
        <div class="provider-name">${esc(p.name)} ${active ? '<span class="chip chip-amber" style="margin-left:3px">当前</span>' : ''}</div>
        <div class="provider-model">${esc(p.model || '—')} · ${p.hasKey ? 'Key 已保存' : p.kind === 'mock' ? '无需 Key' : '未配置 Key'}</div>
      </div>
      <div class="provider-actions">
        ${!active ? `<button class="btn btn-sm" data-action="provider:activate" data-id="${p.id}">启用</button>` : ''}
        ${p.kind === 'mock' ? '' : `<button class="icon-btn" data-action="provider:edit" data-id="${p.id}" title="编辑">${icon('edit')}</button>`}
        ${p.kind === 'mock' ? '' : `<button class="icon-btn" data-action="provider:delete" data-id="${p.id}" title="删除">${icon('trash')}</button>`}
      </div>
    </div>
    ${test ? `<div class="provider-test ${p.lastTestOk ? 'chip-green' : 'chip-red'} chip">${test}</div>` : ''}
  </div>`;
}

function switchEl(path, checked, disabled = false) {
  return `<label class="switch"><input type="checkbox" data-setting="${path}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} /><i></i></label>`;
}

function openProviderSheet(id = null) {
  const existing = id ? state.data.settings.providers.find((p) => p.id === id) : null;
  if (existing?.kind === 'mock') {
    toast('演示模式无需配置，直接添加一个真实模型即可', 'ok');
    return;
  }
  const presets = state.data.runtime.presets;
  const preset = existing ? presets.find((x) => x.baseUrl && x.baseUrl === existing.baseUrl) || presets.find((x) => x.key === 'custom') : presets.find((x) => x.key === 'deepseek');
  const isMock = existing?.kind === 'mock';
  const body = `
    <form id="provider-form" data-id="${existing?.id || ''}">
      <div class="field">
        <label>服务商预设</label>
        <select class="select" data-provider-preset>
          ${presets.map((p) => `<option value="${p.key}" ${preset?.key === p.key ? 'selected' : ''}>${esc(p.name)}${p.note ? ' · ' + esc(p.note) : ''}</option>`).join('')}
        </select>
      </div>
      <div id="provider-fields" class="${isMock ? 'hidden' : ''}">
        <div class="field">
          <label>显示名称</label>
          <input class="input" name="name" maxlength="60" value="${esc(existing?.name || preset?.name || '')}" />
        </div>
        <div class="field">
          <label>Base URL</label>
          <input class="input" name="baseUrl" value="${esc(existing?.baseUrl || preset?.baseUrl || '')}" placeholder="https://api.example.com/v1" />
        </div>
        <div class="field">
          <label>模型名</label>
          <input class="input" name="model" value="${esc(existing?.model || preset?.model || '')}" placeholder="model-name" />
        </div>
        <div class="field">
          <label>API Key</label>
          <input class="input" name="apiKey" type="password" autocomplete="off" placeholder="${existing?.hasKey ? `已保存 ${existing.keyHint || ''}，留空不修改` : 'sk-…'}" />
          <div class="form-note">${preset?.keyUrl ? `获取 Key：<a href="#" data-action="open-url" data-url="${esc(preset.keyUrl)}" style="color:var(--amber)">${esc(preset.keyUrl)}</a>` : '只保存在本机，使用 Windows DPAPI 加密。'}</div>
        </div>
        <div class="field-row">
          <div class="field"><label>温度</label><input class="input" name="temperature" type="number" step="0.1" min="0" max="2" value="${existing?.temperature ?? 0.4}" /></div>
          <div class="field"><label>最大 Token</label><input class="input" name="maxTokens" type="number" min="64" max="16000" value="${existing?.maxTokens ?? 2048}" /></div>
        </div>
      </div>
      <div id="provider-test-result" class="form-note"></div>
      <div class="form-error hidden" id="provider-error"></div>
    </form>`;
  const footer = `
    ${existing && !isMock ? `<button class="btn btn-danger btn-sm" data-action="provider:delete" data-id="${existing.id}">删除</button>` : ''}
    <div class="spacer"></div>
    <button class="btn" data-action="modal:close">取消</button>
    <button class="btn" data-action="provider:test">测试连接</button>
    <button class="btn btn-primary" data-action="provider:save">保存</button>`;
  openSheet({ title: existing ? '编辑模型' : '添加模型', body, footer });
}

async function saveProvider() {
  const form = $('#provider-form');
  if (!form) return;
  const fd = new FormData(form);
  const id = form.dataset.id;
  const presetKey = form.querySelector('[data-provider-preset]')?.value;
  const preset = state.data.runtime.presets.find((p) => p.key === presetKey);
  const kind = preset?.kind || 'openai';
  if (kind === 'mock') {
    closeOverlay();
    toast('演示模式无需配置', 'ok');
    return;
  }
  const provider = {
    id: id || undefined,
    name: String(fd.get('name') || preset?.name || '新模型'),
    kind,
    baseUrl: String(fd.get('baseUrl') || ''),
    model: String(fd.get('model') || ''),
    temperature: Number(fd.get('temperature') || 0.4),
    maxTokens: Number(fd.get('maxTokens') || 2048),
    keyUrl: preset?.keyUrl || '',
  };
  const apiKey = String(fd.get('apiKey') || '').trim();
  const view = await call('providers:save', { provider, apiKey: apiKey || undefined, activate: true });
  if (!view) return;
  closeOverlay();
  state.data = view;
  applyChrome();
  renderView();
  toast('模型已保存', 'ok');
}

async function testProviderFromForm() {
  const form = $('#provider-form');
  if (!form) return;
  const fd = new FormData(form);
  const presetKey = form.querySelector('[data-provider-preset]')?.value;
  const preset = state.data.runtime.presets.find((p) => p.key === presetKey);
  const out = $('#provider-test-result');
  if (preset?.kind === 'mock') {
    out.textContent = '演示模式不需要连接。';
    return;
  }
  out.textContent = '正在连接…';
  out.style.color = 'var(--muted)';
  const result = await call('providers:test', {
    provider: {
      id: form.dataset.id || undefined,
      name: String(fd.get('name') || preset?.name || ''),
      kind: preset?.kind || 'openai',
      baseUrl: String(fd.get('baseUrl') || ''),
      model: String(fd.get('model') || ''),
      temperature: Number(fd.get('temperature') || 0.4),
      maxTokens: Number(fd.get('maxTokens') || 2048),
    },
    apiKey: String(fd.get('apiKey') || ''),
  });
  if (result?.ok) {
    out.textContent = `连接成功 · ${result.ms}ms · ${result.reply || ''}`;
    out.style.color = 'var(--green)';
  } else {
    out.textContent = `连接失败：${result?.error || '未知错误'}`;
    out.style.color = 'var(--red)';
  }
}

/* ------------------------------------------------------------------ */
/* 引导页                                                               */
/* ------------------------------------------------------------------ */

function renderOnboarding() {
  const box = $('#onboarding');
  const presets = state.data?.runtime?.presets || [];
  const preset = presets.find((p) => p.key === 'deepseek') || presets[0];
  box.innerHTML = `
    <div class="onboard-inner">
      <img class="onboard-logo" src="../../assets/icon.png" alt="Dog" />
      <h1 class="onboard-title">认识一下，<br/>你的桌面秘书。</h1>
      <p class="onboard-sub">我帮你记事、盯时间、看着其他 AI 干活，然后把要紧的事用悬浮通知告诉你。</p>
      <div class="onboard-points">
        <div class="onboard-point">${icon('bell')}<span>到点提醒、早报、监工汇总，右上角轻轻浮一下</span></div>
        <div class="onboard-point">${icon('bot')}<span>内部助理、命令行 Agent、外部接口，都能纳管</span></div>
        <div class="onboard-point">${icon('shield')}<span>API Key 只留在本机，Windows 加密保存</span></div>
      </div>
      <form id="onboarding-form">
        <div class="field-row">
          <div class="field"><label>怎么称呼你</label><input class="input" name="userName" maxlength="40" placeholder="老板" /></div>
          <div class="field"><label>秘书名字</label><input class="input" name="assistantName" maxlength="20" value="阿犬" /></div>
        </div>
        <div class="field">
          <label>接哪个模型</label>
          <select class="select" data-onboard-preset>
            ${presets.map((p) => `<option value="${p.key}" ${preset?.key === p.key ? 'selected' : ''}>${esc(p.name)}${p.note ? ' · ' + esc(p.note) : ''}</option>`).join('')}
          </select>
        </div>
        <div id="ob-fields" class="${preset?.kind === 'mock' ? 'hidden' : ''}">
          <div class="field"><label>Base URL</label><input class="input" name="baseUrl" value="${esc(preset?.baseUrl || '')}" /></div>
          <div class="field-row">
            <div class="field"><label>模型名</label><input class="input" name="model" value="${esc(preset?.model || '')}" /></div>
            <div class="field"><label>API Key</label><input class="input" name="apiKey" type="password" autocomplete="off" placeholder="sk-…" /></div>
          </div>
          <div class="provider-preview">${icon('key')}<span id="ob-keyurl">${preset?.keyUrl ? esc(preset.keyUrl) : 'Key 只保存在本机'}</span></div>
        </div>
        <div class="field-row" style="margin-top:10px">
          <div class="field"><label>每天早报时间</label><input class="input" type="time" name="briefingTime" value="08:30" /></div>
          <div class="field"><label>&nbsp;</label><label class="checkbox" style="padding-top:8px"><input type="checkbox" name="demo" checked /><span>载入示例数据</span></label></div>
        </div>
        <div class="form-error hidden" id="onboard-error"></div>
        <div class="onboard-actions">
          <button class="btn btn-primary" type="submit">开始工作</button>
          <button class="btn" type="button" data-action="onboarding:skip">先看看演示</button>
        </div>
        <p class="form-note">不知道填什么？先用演示模式，之后在「设置 → 模型」里随时补上。</p>
      </form>
    </div>`;
  box.classList.remove('hidden');
  box.querySelector('[data-onboard-preset]')?.addEventListener('change', onOnboardPresetChange);
}

function onOnboardPresetChange(e) {
  const key = e.target.value;
  const preset = state.data.runtime.presets.find((p) => p.key === key);
  if (!preset) return;
  const fields = $('#ob-fields');
  fields.classList.toggle('hidden', preset.kind === 'mock');
  const form = $('#onboarding-form');
  if (form) {
    form.elements.baseUrl.value = preset.baseUrl || '';
    form.elements.model.value = preset.model || '';
    form.elements.apiKey.value = '';
  }
  const ku = $('#ob-keyurl');
  if (ku) ku.textContent = preset.keyUrl || 'Key 只保存在本机';
}

async function submitOnboarding(skip = false) {
  const form = $('#onboarding-form');
  if (!form) return;
  const fd = new FormData(form);
  const presetKey = form.querySelector('[data-onboard-preset]')?.value;
  const preset = state.data.runtime.presets.find((p) => p.key === presetKey);
  const kind = skip ? 'mock' : preset?.kind || 'mock';
  const err = $('#onboard-error');
  if (kind !== 'mock') {
    if (!String(fd.get('baseUrl') || '').trim()) return showFormError(err, '请填写 Base URL');
    if (!String(fd.get('model') || '').trim()) return showFormError(err, '请填写模型名');
    const baseUrl = String(fd.get('baseUrl') || '');
    const apiKey = String(fd.get('apiKey') || '').trim();
    if (!apiKey && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(baseUrl)) {
      return showFormError(err, '请填写 API Key；还没有 Key 的话，先选“先看看演示”');
    }
  }
  const btn = form.querySelector('button[type=submit]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '正在准备…';
  }
  try {
    const view = await api.call('app:onboarding', {
      userName: String(fd.get('userName') || ''),
      assistantName: String(fd.get('assistantName') || '阿犬'),
      briefingTime: String(fd.get('briefingTime') || '08:30'),
      demo: fd.get('demo') === 'on',
      provider:
        kind === 'mock'
          ? { kind: 'mock' }
          : {
              name: preset.name,
              kind: preset.kind,
              baseUrl: String(fd.get('baseUrl') || ''),
              model: String(fd.get('model') || ''),
              keyUrl: preset.keyUrl || '',
            },
      apiKey: kind === 'mock' ? '' : String(fd.get('apiKey') || ''),
    });
    state.data = view;
    $('#onboarding').classList.add('hidden');
    state.view = 'home';
    applyChrome();
    renderView();
    toast('我开工了。有事直接说。', 'ok');
  } catch (err2) {
    showFormError(err, err2.message);
    if (btn) {
      btn.disabled = false;
      btn.textContent = '开始工作';
    }
  }
}

/* ------------------------------------------------------------------ */
/* 弹层 / 提示                                                          */
/* ------------------------------------------------------------------ */

function openSheet({ title, body, footer = '' }) {
  const o = $('#overlay');
  o.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-head">
        <h3>${esc(title)}</h3>
        <button class="sheet-close" data-action="modal:close" title="关闭">${icon('x')}</button>
      </div>
      <div class="sheet-body">${body}</div>
      ${footer ? `<div class="sheet-foot">${footer}</div>` : ''}
    </div>`;
  o.classList.remove('hidden');
  setTimeout(() => {
    const f = o.querySelector('.sheet-body input:not([type=hidden]), .sheet-body textarea');
    if (f) f.focus();
  }, 40);
}

function closeOverlay() {
  const o = $('#overlay');
  o.classList.add('hidden');
  o.innerHTML = '';
}

function confirmDialog({ title, message, confirmText = '确定', danger = true }) {
  return new Promise((resolve) => {
    const layer = document.createElement('div');
    layer.className = 'overlay';
    layer.style.zIndex = '100';
    layer.innerHTML = `
      <div class="sheet dialog" role="alertdialog">
        <div class="sheet-head"><h3>${esc(title)}</h3></div>
        <div class="dialog-body">${esc(message)}</div>
        <div class="sheet-foot">
          <button class="btn" data-confirm="no">取消</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm="yes">${esc(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(layer);
    layer.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-confirm]');
      if (btn) {
        layer.remove();
        resolve(btn.dataset.confirm === 'yes');
      } else if (e.target === layer) {
        layer.remove();
        resolve(false);
      }
    });
  });
}

let toastTimer = null;
function toast(message, type = '') {
  const el = $('#app-toast');
  el.textContent = message;
  el.className = 'app-toast show ' + (type === 'err' ? 'err' : type === 'ok' ? 'ok' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'app-toast';
  }, 2600);
}

function showFormError(el, message) {
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  el.scrollIntoView({ block: 'nearest' });
}

async function call(channel, payload) {
  try {
    return await api.call(channel, payload);
  } catch (err) {
    toast(err.message, 'err');
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 工具函数                                                             */
/* ------------------------------------------------------------------ */

function icon(name) {
  return `<svg class="ic"><use href="#i-${name}"></use></svg>`;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function emptyBlock(emoji, title, text) {
  return `<div class="empty"><div class="icon">${emoji}</div><b>${esc(title)}</b><p>${esc(text)}</p></div>`;
}

function localInput(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nextHour() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.getTime();
}

function fmtDue(ms) {
  const d = new Date(ms);
  const now = new Date();
  const diff = ms - now.getTime();
  if (diff > 0 && diff < 60000) return `${Math.max(1, Math.ceil(diff / 1000))} 秒后`;
  const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, now)) return `今天 ${hm}`;
  const tmr = new Date(now);
  tmr.setDate(tmr.getDate() + 1);
  if (same(d, tmr)) return `明天 ${hm}`;
  const yst = new Date(now);
  yst.setDate(yst.getDate() - 1);
  if (same(d, yst)) return `昨天 ${hm}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function fmtAgo(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 0) return fmtDue(ms);
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 2 * 86400000) return '昨天';
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function md(text) {
  let s = esc(text);
  const blocks = [];
  s = s.replace(/```([\s\S]*?)```/g, (_m, code) => {
    blocks.push(`<pre>${code.replace(/^\n+|\n+$/g, '')}</pre>`);
    return `\u0000B${blocks.length - 1}\u0000`;
  });
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/^#{1,3}\s+(.+)$/gm, '<strong>$1</strong>');
  s = s.replace(/^\s*[-*]\s+/gm, '• ');
  s = s.replace(/\n{2,}/g, '\n');
  s = s.replace(/\n/g, '<br/>');
  s = s.replace(/\u0000B(\d+)\u0000/g, (_m, i) => blocks[Number(i)]);
  return s;
}

function patchFor(path, value) {
  const parts = path.split('.');
  const root = {};
  let cur = root;
  parts.forEach((p, i) => {
    if (i === parts.length - 1) cur[p] = value;
    else {
      cur[p] = {};
      cur = cur[p];
    }
  });
  return root;
}

async function updateSettings(patch, note = '') {
  const view = await call('app:update-settings', patch);
  if (!view) return;
  state.data = view;
  applyChrome();
  renderView();
  if (note) toast(note, 'ok');
}

async function refresh() {
  try {
    const view = await api.call('app:bootstrap');
    state.data = view;
    applyChrome();
    renderView();
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ------------------------------------------------------------------ */
/* 事件                                                                 */
/* ------------------------------------------------------------------ */

document.addEventListener('click', async (e) => {
  if (e.target === $('#overlay')) {
    closeOverlay();
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.tagName === 'A') e.preventDefault();
  const action = el.dataset.action;
  const id = el.dataset.id;
  try {
    switch (action) {
      case 'nav:home':
      case 'nav:tasks':
      case 'nav:agents':
      case 'nav:inbox':
      case 'nav:chat':
      case 'nav:settings':
        switchView(action.slice(4));
        break;
      case 'win:min':
        api.call('window:minimize');
        break;
      case 'win:hide':
        api.call('window:close');
        break;
      case 'app:quit': {
        const ok = await confirmDialog({ title: '退出 Dog', message: '退出后不再监工和提醒。确定吗？', confirmText: '退出' });
        if (ok) api.call('app:quit');
        break;
      }
      case 'modal:close':
        closeOverlay();
        break;
      case 'task:new':
        openTaskSheet();
        break;
      case 'task:edit':
        openTaskSheet(id);
        break;
      case 'task:toggle': {
        e.stopPropagation();
        const t = state.data.tasks.find((x) => x.id === id);
        if (!t) break;
        const wasDone = t.status === 'done';
        if (wasDone) await call('tasks:reopen', { id });
        else await call('tasks:complete', { id });
        await refresh();
        toast(wasDone ? '已重新打开' : `已完成：${t.title}`, 'ok');
        break;
      }
      case 'task:filter':
        state.taskFilter = el.dataset.filter;
        renderView();
        break;
      case 'tasks:show-active':
        state.taskFilter = 'active';
        state.view = 'tasks';
        closeOverlay();
        applyChrome();
        renderView();
        $('#view').scrollTop = 0;
        break;
      case 'tasks:show-done':
        state.taskFilter = 'done';
        state.view = 'tasks';
        closeOverlay();
        applyChrome();
        renderView();
        $('#view').scrollTop = 0;
        break;
      case 'task:prio': {
        const p = Number(el.dataset.prio);
        const wrap = el.parentElement;
        wrap.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === el));
        wrap.parentElement.querySelector('input[name=priority]').value = String(p);
        break;
      }
      case 'task:save':
        await saveTask();
        break;
      case 'task:delete': {
        e.stopPropagation();
        const ok = await confirmDialog({ title: '删除事项', message: '删除后无法恢复，确定吗？', confirmText: '删除' });
        if (ok) {
          await call('tasks:delete', { id });
          closeOverlay();
          await refresh();
        }
        break;
      }
      case 'task:reopen':
        await call('tasks:reopen', { id });
        closeOverlay();
        await refresh();
        break;
      case 'agent:new':
        openAgentSheet();
        break;
      case 'agent:edit':
        openAgentSheet(id);
        break;
      case 'agent:save':
        await saveAgent();
        break;
      case 'agent:delete': {
        const ok = await confirmDialog({ title: '删除智能体', message: '删除后不再显示它，但历史任务会保留。确定吗？', confirmText: '删除' });
        if (ok) {
          await call('agents:delete', { id });
          closeOverlay();
          await refresh();
        }
        break;
      }
      case 'agent:start':
        openStartSheet(id);
        break;
      case 'agent:dispatch':
        await dispatchAgent();
        break;
      case 'agent:detail':
        await openRunSheet(id);
        break;
      case 'run:refresh':
        await openRunSheet(id);
        break;
      case 'run:tab':
        state.runTab = el.dataset.tab;
        renderRunSheet();
        break;
      case 'agent:ack':
        await call('agents:ack', { runId: id });
        closeOverlay();
        await refresh();
        toast('已确认', 'ok');
        break;
      case 'agent:cancel': {
        const ok = await confirmDialog({ title: '取消任务', message: '智能体会被终止，已经产出的内容会保留。确定吗？', confirmText: '取消任务' });
        if (ok) {
          await call('agents:cancel', { runId: id });
          closeOverlay();
          await refresh();
        }
        break;
      }
      case 'agent:summary':
        el.disabled = true;
        toast('正在汇总智能体进度…');
        await call('supervisor:run');
        el.disabled = false;
        await refresh();
        break;
      case 'inbox:expand': {
        if (state.expandedInbox === id) state.expandedInbox = null;
        else {
          state.expandedInbox = id;
          const item = state.data.inbox.find((i) => i.id === id);
          if (item && !item.read) {
            item.read = true;
            api.call('inbox:read', { id });
          }
        }
        applyChrome();
        renderView();
        break;
      }
      case 'inbox:read-all':
        await call('inbox:read-all');
        await refresh();
        break;
      case 'inbox:clear': {
        const ok = await confirmDialog({ title: '清理已读', message: '已读消息会被删除，未读的会保留。', confirmText: '清理' });
        if (ok) {
          await call('inbox:clear-read');
          await refresh();
        }
        break;
      }
      case 'inbox:run':
        await openRunSheet(id);
        break;
      case 'inbox:task':
        openTaskSheet(id);
        break;
      case 'chat:clear': {
        const ok = await confirmDialog({ title: '清空对话', message: '聊天记录会清空，事项和智能体不受影响。', confirmText: '清空' });
        if (ok) {
          await call('chat:clear');
          state.chatError = '';
          await refresh();
        }
        break;
      }
      case 'chat:suggest': {
        const text = el.dataset.text;
        await sendChat(text);
        break;
      }
      case 'settings:add-provider':
        openProviderSheet();
        break;
      case 'provider:edit':
        openProviderSheet(id);
        break;
      case 'provider:activate': {
        const view = await call('providers:activate', { id });
        if (view) {
          state.data = view;
          applyChrome();
          renderView();
          toast('已切换模型', 'ok');
        }
        break;
      }
      case 'provider:delete': {
        const ok = await confirmDialog({ title: '删除模型', message: '只删除配置，不影响已保存的事项。', confirmText: '删除' });
        if (ok) {
          const view = await call('providers:delete', { id });
          closeOverlay();
          if (view) {
            state.data = view;
            applyChrome();
            renderView();
          }
        }
        break;
      }
      case 'provider:save':
        await saveProvider();
        break;
      case 'provider:test':
        await testProviderFromForm();
        break;
      case 'settings:test-toast':
        await call('toast:test', {});
        break;
      case 'settings:briefing':
        toast('正在生成简报…');
        await call('briefing:run');
        await refresh();
        break;
      case 'settings:copy':
        await api.call('app:copy', { text: el.dataset.copy || '' });
        toast('已复制', 'ok');
        break;
      case 'settings:open-data':
        await api.call('app:open-data');
        break;
      case 'settings:export': {
        const res = await api.call('app:export');
        if (res && !res.canceled) toast('已导出到 ' + res.path, 'ok');
        break;
      }
      case 'settings:reset': {
        const ok = await confirmDialog({
          title: '清空并重新开始',
          message: '会先自动备份当前数据，然后清空事项、智能体、对话与设置。确定吗？',
          confirmText: '清空',
        });
        if (ok) {
          const view = await call('app:reset');
          if (view) {
            state.data = view;
            state.view = 'home';
            applyChrome();
            renderView();
            if (!view.meta.onboarded) renderOnboarding();
          }
        }
        break;
      }
      case 'settings:mute':
        await call('app:mute', { minutes: 60 });
        await refresh();
        toast('已静音 1 小时', 'ok');
        break;
      case 'settings:unmute':
        await call('app:unmute');
        await refresh();
        toast('已恢复通知', 'ok');
        break;
      case 'settings:restart-api':
        toast('正在重启本地接口…');
        await call('agentApi:restart');
        await refresh();
        break;
      case 'settings:rotate-token':
        await call('agentApi:rotate');
        await refresh();
        toast('Token 已更换', 'ok');
        break;
      case 'settings:login': {
        const enabled = el.checked;
        const res = await api.call('app:set-login', { enabled });
        if (res && !res.packaged) {
          toast('开发模式不可用，打包后生效', 'err');
          await refresh();
        } else {
          await call('app:update-settings', { launchAtLogin: enabled });
          await refresh();
        }
        break;
      }
      case 'onboarding:skip':
        await submitOnboarding(true);
        break;
      case 'open-url':
        await api.call('app:open-external', { url: el.dataset.url });
        break;
      default:
        break;
    }
  } catch (err) {
    toast(err.message, 'err');
  }
});

document.addEventListener('change', async (e) => {
  const presetSel = e.target.closest('[data-provider-preset]');
  if (presetSel) {
    const preset = state.data.runtime.presets.find((p) => p.key === presetSel.value);
    const form = $('#provider-form');
    if (preset && form) {
      const mock = preset.kind === 'mock';
      $('#provider-fields').classList.toggle('hidden', mock);
      if (!mock) {
        form.elements.name.value = preset.name;
        form.elements.baseUrl.value = preset.baseUrl || '';
        form.elements.model.value = preset.model || '';
      }
    }
    return;
  }

  if (e.target.matches('[data-agent-kind]')) {
    const kind = e.target.value;
    $$('[data-kind-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.kindPanel !== kind));
    return;
  }

  const setting = e.target.closest('[data-setting]');
  if (setting) {
    let value = setting.type === 'checkbox' ? setting.checked : setting.value;
    if (setting.dataset.type === 'number') value = Number(value);
    await updateSettings(patchFor(setting.dataset.setting, value));
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'chat-input') {
    state.chatDraft = e.target.value;
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(92, e.target.scrollHeight) + 'px';
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#overlay').classList.contains('hidden')) {
      closeOverlay();
      return;
    }
  }
  if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'chat-input') {
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    $('#chat-form')?.requestSubmit();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && e.target.id === 'chat-input') {
    e.preventDefault();
    $('#chat-form')?.requestSubmit();
  }
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (form.id === 'quick-form') {
    const input = form.querySelector('input[name=text]');
    const text = String(input.value || '').trim();
    if (!text) return;
    const task = await call('tasks:quick-add', { text });
    if (!task) return;
    input.value = '';
    await refresh();
    toast(task.dueAt ? `记下了 · ${fmtDue(task.dueAt)}` : '已记到待办，可在「待办」里查看', 'ok');
    if (state.view !== 'home') switchView('home');
  } else if (form.id === 'chat-form') {
    const input = form.querySelector('textarea');
    const text = String(input.value || '').trim();
    if (!text) return;
    input.value = '';
    state.chatDraft = '';
    await sendChat(text);
  } else if (form.id === 'profile-form') {
    const fd = new FormData(form);
    await updateSettings(
      {
        userName: String(fd.get('userName') || ''),
        assistantName: String(fd.get('assistantName') || '阿犬'),
        persona: String(fd.get('persona') || ''),
      },
      '已保存'
    );
  } else if (form.id === 'instruct-form') {
    const fd = new FormData(form);
    const message = String(fd.get('message') || '').trim();
    if (!message) return;
    await call('agents:instruct', { runId: form.dataset.run, message });
    await openRunSheet(form.dataset.run);
    toast('指令已记录', 'ok');
  } else if (form.id === 'onboarding-form') {
    await submitOnboarding(false);
  } else if (form.id === 'task-form') {
    await saveTask();
  } else if (form.id === 'agent-form') {
    await saveAgent();
  } else if (form.id === 'provider-form') {
    await saveProvider();
  }
});

window.dog.onState(({ state: next }) => {
  state.data = next;
  applyChrome();
  if (!next.meta.onboarded) {
    if ($('#onboarding').classList.contains('hidden')) renderOnboarding();
    return;
  }
  $('#onboarding').classList.add('hidden');
  if (state.view === 'chat' && (state.chatBusy || state.chatDraft)) {
    return;
  }
  renderView();
});

window.dog.onNavigate(({ view }) => {
  if (view) switchView(view);
});

window.dog.onFocusQuick(() => {
  switchView('home');
  setTimeout(() => $('#quick-input')?.focus(), 80);
});

window.dog.onChatEvent((evt) => {
  if (evt.type === 'tool') {
    if (evt.status === 'running') state.toolStatus = `正在${TOOL_LABEL[evt.name] || '处理'}…`;
    else state.toolStatus = '阿犬正在想…';
  } else if (evt.type === 'thinking') {
    state.toolStatus = state.toolStatus || '阿犬正在想…';
  }
  const el = $('#composer-status');
  if (el) el.textContent = state.chatBusy ? state.toolStatus : '';
});
