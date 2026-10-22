(() => {
  const ICONS = {
    reminder: '🕐',
    briefing: '🌅',
    review: '🌙',
    supervision: '👀',
    completion: '✅',
    failure: '⚠️',
    attention: '⚠️',
    system: '🐕',
  };
  const root = document.getElementById('toast');
  const iconEl = document.getElementById('icon');
  const titleEl = document.getElementById('title');
  const bodyEl = document.getElementById('body');
  const timeEl = document.getElementById('time');
  const bar = document.getElementById('bar');
  const closeBtn = document.getElementById('close');
  let current = null;
  let paused = false;

  window.toastAPI.onData((payload) => {
    current = payload;
    const kind = payload.kind || 'system';
    root.dataset.kind = kind;
    iconEl.textContent = ICONS[kind] || ICONS.system;
    titleEl.textContent = payload.title || 'Dog 秘书';
    bodyEl.textContent = payload.body || '';
    timeEl.textContent = payload.time || '';
    bar.style.setProperty('--duration', `${payload.duration || 9}s`);
    document.documentElement.style.setProperty('--duration', `${payload.duration || 9}s`);
    requestAnimationFrame(() => root.classList.add('ready'));
  });

  window.toastAPI.onHide(() => {
    root.classList.add('hide');
  });

  function setHover(value) {
    if (paused === value) return;
    paused = value;
    root.classList.toggle('paused', value);
    window.toastAPI.hover(value);
  }

  document.body.addEventListener('mouseenter', () => setHover(true));
  document.body.addEventListener('mouseleave', () => setHover(false));

  document.body.addEventListener('click', (e) => {
    if (e.target.closest('.close')) return;
    if (current) window.toastAPI.open();
  });

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.toastAPI.dismiss();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.toastAPI.dismiss();
  });
})();
