'use strict';

/**
 * 原版网易云右上角的「一起听」悬浮面板。
 * Shadow DOM 隔离样式；所有内容只通过 textContent 写入。
 */

const PANEL_CSS = `
  :host {
    all: initial;
    --control-h: 34px;
    --red: #ec4141;
    --red-hover: #f05252;
    --bg: #ffffff;
    --bg-soft: #f4f4f4;
    --bg-input: #f7f7f7;
    --fg: #2b2b2b;
    --muted: #8a8a8a;
    --line: rgba(0, 0, 0, .11);
    --hover: rgba(0, 0, 0, .055);
    --shadow: 0 12px 32px rgba(0, 0, 0, .16);
    --toast-bg: #3a3a3a;
    --toast-fg: #ffffff;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :host {
      --bg: #2a2a2b;
      --bg-soft: #343436;
      --bg-input: #242425;
      --fg: #e9e9e9;
      --muted: #a0a0a0;
      --line: rgba(255, 255, 255, .13);
      --hover: rgba(255, 255, 255, .08);
      --shadow: 0 12px 32px rgba(0, 0, 0, .46);
      --toast-bg: #f1f1f1;
      --toast-fg: #222222;
    }
  }
  :host([data-theme="dark"]),
  :host-context(.theme-dark),
  :host-context(.dark),
  :host-context([data-theme="dark"]) {
    --bg: #2a2a2b;
    --bg-soft: #343436;
    --bg-input: #242425;
    --fg: #e9e9e9;
    --muted: #a0a0a0;
    --line: rgba(255, 255, 255, .13);
    --hover: rgba(255, 255, 255, .08);
    --shadow: 0 12px 32px rgba(0, 0, 0, .46);
    --toast-bg: #f1f1f1;
    --toast-fg: #222222;
  }
  :host([data-theme="light"]),
  :host-context(.theme-light),
  :host-context([data-theme="light"]) {
    --bg: #ffffff;
    --bg-soft: #f4f4f4;
    --bg-input: #f7f7f7;
    --fg: #2b2b2b;
    --muted: #8a8a8a;
    --line: rgba(0, 0, 0, .11);
    --hover: rgba(0, 0, 0, .055);
    --shadow: 0 12px 32px rgba(0, 0, 0, .16);
    --toast-bg: #3a3a3a;
    --toast-fg: #ffffff;
  }
  *, *::before, *::after { box-sizing: border-box; }
  [hidden] { display: none !important; }
  button, input { font: inherit; color: inherit; }

  .entry {
    position: fixed;
    top: 64px;
    right: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    height: var(--control-h);
    padding: 0 15px;
    border: 0;
    border-radius: 999px;
    background: var(--red);
    color: #fff;
    font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI",
      "Microsoft YaHei", sans-serif;
    white-space: nowrap;
    cursor: grab;
    touch-action: none;
    user-select: none;
    box-shadow: 0 3px 12px rgba(236, 65, 65, .28);
  }
  .entry:hover { background: var(--red-hover); }
  .entry.joined { background: #d53838; }
  .entry.dragging { cursor: grabbing; }
  .entry:focus-visible,
  .panel button:focus-visible,
  .panel input:focus-visible,
  .queueBlock summary:focus-visible {
    outline: 2px solid rgba(236, 65, 65, .38);
    outline-offset: 2px;
  }

  .panel {
    position: fixed;
    top: 106px;
    right: 16px;
    width: min(324px, calc(100vw - 32px));
    max-height: calc(100vh - 16px);
    overflow: auto;
    padding: 10px 12px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg);
    color: var(--fg);
    font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI",
      "Microsoft YaHei", sans-serif;
    box-shadow: var(--shadow);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: var(--control-h);
    margin-bottom: 10px;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .head.dragging { cursor: grabbing; }
  .headTitle {
    min-width: 0;
    overflow: hidden;
    font-size: 14px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .panel button.close {
    flex: none;
    width: var(--control-h);
    height: var(--control-h);
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    touch-action: manipulation;
  }
  .panel button.close:hover { background: var(--hover); color: var(--fg); }

  .idle, .active { display: flex; flex-direction: column; gap: 10px; }
  .panel button {
    height: var(--control-h);
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-soft);
    color: var(--fg);
    font-size: 13px;
    white-space: nowrap;
    cursor: pointer;
  }
  .panel button:hover:not(:disabled) { background: var(--hover); }
  .panel button.primary {
    border-color: transparent;
    background: var(--red);
    color: #fff;
  }
  .panel button.primary:hover:not(:disabled) { background: var(--red-hover); }
  .panel button.danger { border-color: transparent; background: transparent; color: #e04747; }
  .panel button.danger:hover:not(:disabled) { background: rgba(236, 65, 65, .08); }
  .panel button:disabled { opacity: .45; cursor: default; }

  .create { width: 100%; }
  .joinRow {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
  }
  .joinInput {
    width: 100%;
    min-width: 0;
    height: var(--control-h);
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    outline: none;
    background: var(--bg-input);
    color: var(--fg);
    user-select: text;
  }
  .joinInput::placeholder { color: var(--muted); }
  .joinInput:focus { border-color: var(--red); }

  .nowPlaying { min-width: 0; padding-top: 1px; }
  .song {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    font-weight: 600;
  }
  .roomActions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 8px;
    align-items: center;
  }
  .copy { overflow: hidden; text-overflow: ellipsis; }
  .follow {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--control-h);
    padding: 0 9px;
    border: 1px solid var(--line);
    border-radius: 8px;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
  }
  .follow:hover { background: var(--hover); }
  .follow input {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--red);
  }

  .queueBlock { min-width: 0; }
  .queueBlock summary {
    padding: 3px 0;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
    user-select: none;
  }
  .queueBlock summary:hover { color: var(--fg); }
  .queue {
    max-height: 120px;
    margin: 4px 0 0;
    padding: 0;
    overflow: auto;
    list-style: none;
  }
  .queue li {
    overflow: hidden;
    padding: 2px 0;
    color: var(--fg);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .feedback {
    position: fixed;
    right: 16px;
    bottom: 20px;
    z-index: 2147483001;
    max-width: min(324px, calc(100vw - 32px));
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--toast-bg);
    color: var(--toast-fg);
    font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI",
      "Microsoft YaHei", sans-serif;
    word-break: break-word;
    pointer-events: none;
    box-shadow: 0 8px 24px rgba(0, 0, 0, .24);
  }
  .feedback.error { background: #c93636; color: #fff; }
  .feedback:empty { display: none; }
`;

function mountRoomPanel(controller, options = {}) {
  const doc =
    options.document ||
    (typeof document !== 'undefined' ? document : null);
  const win =
    options.window || (typeof window !== 'undefined' ? window : null);

  if (!doc || typeof doc.createElement !== 'function') {
    return { open() {}, dispose() {}, notify() {} };
  }
  if (
    !controller ||
    typeof controller.subscribe !== 'function' ||
    typeof controller.getState !== 'function'
  ) {
    throw new TypeError('mountRoomPanel 需要一起听 controller');
  }

  const parent = doc.body || doc.documentElement;
  if (!parent) return { open() {}, dispose() {}, notify() {} };

  const STORAGE_KEY = 'ncm-listen-together:ui-position:v1';
  const DRAG_THRESHOLD = 5;
  const ENTRY_SIZE = { width: 84, height: 34 };

  const host = doc.createElement('div');
  host.setAttribute('data-ncm-listen-together', 'ui');
  host.style.position = 'fixed';
  // 放在标题栏下方，避开原版窗口按钮。
  host.style.top = '64px';
  host.style.right = '16px';
  host.style.zIndex = '2147483000';
  host.style.width = '0';
  host.style.height = '0';

  const shadow = host.attachShadow
    ? host.attachShadow({ mode: 'open' })
    : host;

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const styleEl = el('style');
  styleEl.textContent = PANEL_CSS;
  shadow.appendChild(styleEl);

  const entry = el('button', 'entry', '一起听');
  entry.type = 'button';
  entry.setAttribute('aria-expanded', 'false');

  const panel = el('section', 'panel');
  panel.setAttribute('aria-label', '一起听');
  panel.hidden = true;

  const head = el('header', 'head');
  const headTitle = el('span', 'headTitle', '一起听');
  const closeBtn = el('button', 'close', '×');
  closeBtn.type = 'button';
  closeBtn.title = '关闭';
  closeBtn.setAttribute('aria-label', '关闭');
  head.appendChild(headTitle);
  head.appendChild(closeBtn);

  const idle = el('div', 'idle');
  const createBtn = el('button', 'create primary', '开房');
  createBtn.type = 'button';
  const joinRow = el('div', 'joinRow');
  const joinInput = el('input', 'joinInput');
  joinInput.type = 'text';
  joinInput.placeholder = '粘贴邀请链接';
  joinInput.setAttribute('aria-label', '邀请链接');
  joinInput.autocomplete = 'off';
  joinInput.spellcheck = false;
  const joinBtn = el('button', 'join', '加入');
  joinBtn.type = 'button';
  joinRow.appendChild(joinInput);
  joinRow.appendChild(joinBtn);
  idle.appendChild(createBtn);
  idle.appendChild(joinRow);

  const active = el('div', 'active');
  active.hidden = true;

  const nowPlaying = el('div', 'nowPlaying');
  const songEl = el('div', 'song');
  nowPlaying.hidden = true;
  nowPlaying.appendChild(songEl);

  const roomActions = el('div', 'roomActions');
  const copyBtn = el('button', 'copy', '复制邀请');
  copyBtn.type = 'button';
  const followLabel = el('label', 'follow');
  const followToggle = el('input', 'followToggle');
  followToggle.type = 'checkbox';
  const followText = el('span', 'followLabel', '同步播放');
  followLabel.appendChild(followToggle);
  followLabel.appendChild(followText);
  const leaveBtn = el('button', 'leave danger', '退出');
  leaveBtn.type = 'button';
  roomActions.appendChild(copyBtn);
  roomActions.appendChild(followLabel);
  roomActions.appendChild(leaveBtn);

  const queueBlock = el('details', 'queueBlock');
  queueBlock.hidden = true;
  const queueSummary = el('summary', 'queueSummary', '待播');
  const queueEl = el('ul', 'queue');
  queueBlock.appendChild(queueSummary);
  queueBlock.appendChild(queueEl);

  active.appendChild(nowPlaying);
  active.appendChild(roomActions);
  active.appendChild(queueBlock);

  const feedbackEl = el('div', 'feedback hint');
  feedbackEl.setAttribute('role', 'status');
  feedbackEl.setAttribute('aria-live', 'polite');
  feedbackEl.setAttribute('aria-atomic', 'true');

  panel.appendChild(head);
  panel.appendChild(idle);
  panel.appendChild(active);
  shadow.appendChild(entry);
  shadow.appendChild(panel);
  shadow.appendChild(feedbackEl);

  let disposed = false;
  let opened = false;
  let refreshed = false;
  let silentRefresh = false;
  let feedbackTimer = null;
  let announcedError = '';

  let entryPos = null;
  let panelPos = null;
  let panelMoved = false;
  let dragState = null;
  let clickGuard = null;
  let clickGuardNode = null;
  let clickGuardTimer = null;

  function later(fn, ms) {
    if (win && typeof win.setTimeout === 'function') return win.setTimeout(fn, ms);
    return setTimeout(fn, ms);
  }

  function cancelLater(id) {
    if (id == null) return;
    if (win && typeof win.clearTimeout === 'function') win.clearTimeout(id);
    else clearTimeout(id);
  }

  function clearFeedback() {
    if (feedbackTimer != null) {
      cancelLater(feedbackTimer);
      feedbackTimer = null;
    }
    feedbackEl.textContent = '';
    feedbackEl.classList.remove('error');
  }

  function showFeedback(message, isError = false) {
    if (disposed) return;
    const text = String(message == null ? '' : message).trim();
    if (!text) {
      clearFeedback();
      return;
    }
    if (feedbackTimer != null) cancelLater(feedbackTimer);
    feedbackEl.textContent = text;
    feedbackEl.classList.toggle('error', !!isError);
    feedbackEl.setAttribute('aria-live', isError ? 'assertive' : 'polite');
    feedbackTimer = later(() => {
      feedbackTimer = null;
      if (!disposed) {
        feedbackEl.textContent = '';
        feedbackEl.classList.remove('error');
      }
    }, isError ? 5000 : 2200);
  }

  function readText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function songText(title, artist) {
    const name = readText(title);
    const singer = readText(artist);
    if (name && singer) return `${name} · ${singer}`;
    if (name) return name;
    if (singer) return `未知歌曲 · ${singer}`;
    return '未知歌曲';
  }

  function roomTitle(state) {
    const owner = readText(state.roomOwnerName);
    if (owner) return `${owner}的房间`;
    if (state.isOwner) return '我的房间';
    return '一起听房间';
  }

  function viewportSize() {
    const root = doc.documentElement || {};
    const body = doc.body || {};
    let width = win && Number(win.innerWidth);
    let height = win && Number(win.innerHeight);
    if (!(width > 0)) width = Number(root.clientWidth) || Number(body.clientWidth) || 0;
    if (!(height > 0)) height = Number(root.clientHeight) || Number(body.clientHeight) || 0;
    return { width: Math.max(1, width), height: Math.max(1, height) };
  }

  function panelFallbackSize() {
    const viewport = viewportSize();
    return {
      width: Math.min(324, Math.max(160, viewport.width - 32)),
      height: Math.min(260, Math.max(80, viewport.height - 96)),
    };
  }

  function measure(node, fallback) {
    let width = 0;
    let height = 0;
    try {
      if (node && typeof node.getBoundingClientRect === 'function') {
        const rect = node.getBoundingClientRect();
        if (rect) {
          width = Number(rect.width) || 0;
          height = Number(rect.height) || 0;
        }
      }
    } catch (_error) {
      // 测量失败时使用兜底尺寸。
    }
    if (!(width > 0)) width = Number(node && node.offsetWidth) || 0;
    if (!(height > 0)) height = Number(node && node.offsetHeight) || 0;
    if (!(width > 0)) width = fallback.width;
    if (!(height > 0)) height = fallback.height;
    return { width, height };
  }

  function clampPoint(point, size) {
    const viewport = viewportSize();
    const maxLeft = Math.max(0, viewport.width - size.width);
    const maxTop = Math.max(0, viewport.height - size.height);
    return {
      left: Math.min(Math.max(0, Number(point.left) || 0), maxLeft),
      top: Math.min(Math.max(0, Number(point.top) || 0), maxTop),
    };
  }

  function applyPosition(node, point) {
    node.style.left = `${Math.round(point.left)}px`;
    node.style.top = `${Math.round(point.top)}px`;
    node.style.right = 'auto';
  }

  function storageRef() {
    try {
      return win && win.localStorage ? win.localStorage : null;
    } catch (_error) {
      return null;
    }
  }

  function validPoint(value) {
    if (!value || typeof value !== 'object') return null;
    const left = Number(value.left);
    const top = Number(value.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
    return { left, top };
  }

  function readSavedPositions() {
    try {
      const storage = storageRef();
      if (!storage) return;
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;
      const savedEntry = validPoint(saved.entry);
      const savedPanel = validPoint(saved.panel);
      if (savedEntry) entryPos = savedEntry;
      if (savedPanel) {
        panelPos = savedPanel;
        panelMoved = true;
      }
    } catch (_error) {
      // 本机位置仅用于便利，存储不可用或损坏都不影响面板。
    }
  }

  function savePositions() {
    try {
      const storage = storageRef();
      if (!storage) return;
      const saved = {};
      if (entryPos) saved.entry = { left: entryPos.left, top: entryPos.top };
      if (panelMoved && panelPos) saved.panel = { left: panelPos.left, top: panelPos.top };
      if (saved.entry || saved.panel) storage.setItem(STORAGE_KEY, JSON.stringify(saved));
      else storage.removeItem(STORAGE_KEY);
    } catch (_error) {
      // 忽略无痕模式、被禁用等存储异常。
    }
  }

  function elementRect(node, kind) {
    const fallback = kind === 'entry' ? ENTRY_SIZE : panelFallbackSize();
    const size = measure(node, fallback);
    let rect = null;
    try {
      rect = node && typeof node.getBoundingClientRect === 'function'
        ? node.getBoundingClientRect()
        : null;
    } catch (_error) {
      rect = null;
    }

    const hasLayout = !!(
      rect &&
      ((Number(rect.width) || 0) > 0 || (Number(rect.height) || 0) > 0)
    );
    if (hasLayout) {
      const width = Number(rect.width) || size.width;
      const height = Number(rect.height) || size.height;
      const left = Number(rect.left) || 0;
      const top = Number(rect.top) || 0;
      return {
        left, top, width, height,
        right: left + width, bottom: top + height,
      };
    }

    const viewport = viewportSize();
    const styledLeft = Number.parseFloat(node && node.style ? node.style.left : '');
    const styledTop = Number.parseFloat(node && node.style ? node.style.top : '');
    if (Number.isFinite(styledLeft) || Number.isFinite(styledTop)) {
      const left = Number.isFinite(styledLeft) ? styledLeft : 0;
      const top = Number.isFinite(styledTop) ? styledTop : 0;
      return {
        left, top, width: size.width, height: size.height,
        right: left + size.width, bottom: top + size.height,
      };
    }

    const pos = kind === 'entry'
      ? entryPos
      : (panelMoved ? panelPos : null);
    let left;
    let top;
    if (pos) {
      left = pos.left;
      top = pos.top;
    } else if (kind === 'entry') {
      left = Math.max(0, viewport.width - 16 - size.width);
      top = Math.min(64, Math.max(0, viewport.height - size.height));
    } else {
      left = Math.max(0, viewport.width - 16 - size.width);
      top = Math.min(106, Math.max(0, viewport.height - size.height));
    }
    return {
      left, top, width: size.width, height: size.height,
      right: left + size.width, bottom: top + size.height,
    };
  }

  function positionPanelNearEntry() {
    if (disposed || panel.hidden) return;
    const entryRect = elementRect(entry, 'entry');
    const size = measure(panel, panelFallbackSize());
    const viewport = viewportSize();

    let left = entryRect.right - size.width;
    if (left < 0) left = entryRect.left;
    let top = entryRect.bottom + 8;
    if (top + size.height > viewport.height) {
      const above = entryRect.top - 8 - size.height;
      top = above >= 0 ? above : Math.max(0, viewport.height - size.height);
    }
    applyPosition(panel, clampPoint({ left, top }, size));
  }

  function positionPanel() {
    if (panelMoved && panelPos) {
      const size = measure(panel, panelFallbackSize());
      panelPos = clampPoint(panelPos, size);
      applyPosition(panel, panelPos);
      return;
    }
    positionPanelNearEntry();
  }

  function clampEntry() {
    const size = measure(entry, ENTRY_SIZE);
    if (entryPos) {
      entryPos = clampPoint(entryPos, size);
      applyPosition(entry, entryPos);
      return;
    }
    const rect = elementRect(entry, 'entry');
    const viewport = viewportSize();
    if (
      rect.left < 0 ||
      rect.top < 0 ||
      rect.right > viewport.width ||
      rect.bottom > viewport.height
    ) {
      applyPosition(entry, clampPoint({ left: rect.left, top: rect.top }, size));
    }
  }

  function onResize() {
    if (disposed) return;
    clampEntry();
    if (panelMoved && panelPos) {
      // 面板隐藏时量不到真实高度，保留位置，等打开时再按实际尺寸 clamp。
      if (panel.hidden) return;
      const size = measure(panel, panelFallbackSize());
      panelPos = clampPoint(panelPos, size);
      applyPosition(panel, panelPos);
    } else if (opened) {
      positionPanelNearEntry();
    }
  }

  function legacyCopy(text) {
    const container = doc.body || doc.documentElement;
    if (!container || typeof doc.execCommand !== 'function') return false;
    const area = el('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    area.style.top = '0';
    area.style.opacity = '0';
    container.appendChild(area);
    let copied = false;
    try {
      area.focus();
      area.select();
      copied = !!doc.execCommand('copy');
    } catch (_error) {
      copied = false;
    } finally {
      if (area.parentNode) area.parentNode.removeChild(area);
    }
    return copied;
  }

  async function copyInvite() {
    const text = String(controller.getState().inviteLink || '');
    if (!text) {
      showFeedback('邀请链接尚未生成', true);
      return;
    }

    let copied = false;
    try {
      const navigatorRef = win && win.navigator;
      if (
        navigatorRef &&
        navigatorRef.clipboard &&
        typeof navigatorRef.clipboard.writeText === 'function'
      ) {
        await navigatorRef.clipboard.writeText(text);
        copied = true;
      }
    } catch (_error) {
      copied = false;
    }

    if (!copied) copied = legacyCopy(text);
    showFeedback(copied ? '已复制' : '复制失败，请重试', !copied);
  }

  function renderQueue(queue) {
    const items = Array.isArray(queue) ? queue : [];
    const labels = items.map(item => songText(item?.title, item?.artist));
    if (queueEl.children.length === labels.length &&
        labels.every((label, index) => queueEl.children[index].textContent === label)) return;
    queueBlock.hidden = items.length === 0;
    queueEl.textContent = '';
    if (!items.length) {
      queueSummary.textContent = '';
      return;
    }
    queueSummary.textContent = '待播';
    for (const label of labels) {
      const li = el('li');
      li.textContent = label;
      queueEl.appendChild(li);
    }
  }

  function render(state) {
    if (disposed || !state) return;
    const joined = !!state.roomId;
    const operation = state.busy;
    const busy = Boolean(operation);

    const errorText = String(state.error || state.syncError || '');
    if (!errorText) {
      announcedError = '';
    } else if (errorText !== announcedError) {
      announcedError = errorText;
      if (!silentRefresh) showFeedback(errorText, true);
    }

    headTitle.textContent = joined ? roomTitle(state) : '一起听';
    panel.setAttribute('aria-label', headTitle.textContent);
    entry.classList.toggle('joined', joined);
    entry.setAttribute('aria-expanded', opened ? 'true' : 'false');

    idle.hidden = joined;
    active.hidden = !joined;

    createBtn.disabled = busy;
    joinInput.disabled = busy;
    joinBtn.disabled = busy;
    createBtn.textContent = operation === 'create' ? '开房中…' : '开房';
    joinBtn.textContent = operation === 'join' ? '加入中…' : '加入';

    const roomPlayback = joined ? state.roomPlayback : null;
    const hasSong = !!roomPlayback;
    nowPlaying.hidden = !hasSong;
    songEl.textContent = hasSong
      ? songText(roomPlayback.title, roomPlayback.artist)
      : '';

    const inviteLink = String(state.inviteLink || '');
    copyBtn.disabled = !joined || !inviteLink || busy;

    followToggle.disabled = busy;
    followToggle.checked = state.following !== false;
    leaveBtn.disabled = busy;
    leaveBtn.textContent = operation === 'leave' ? '退出中…' : '退出';

    renderQueue(joined ? state.queue : []);
  }

  function releaseClickGuard() {
    if (clickGuard && clickGuardNode) {
      clickGuardNode.removeEventListener('click', clickGuard, true);
      clickGuard = null;
      clickGuardNode = null;
    }
    if (clickGuardTimer != null) {
      cancelLater(clickGuardTimer);
      clickGuardTimer = null;
    }
  }

  function suppressClickOn(node) {
    releaseClickGuard();
    clickGuardNode = node;
    clickGuard = (event) => {
      if (event) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
      }
      releaseClickGuard();
    };
    node.addEventListener('click', clickGuard, true);
    clickGuardTimer = later(releaseClickGuard, 450);
  }

  function samePointer(event) {
    if (!dragState) return false;
    if (dragState.pointerId == null || event.pointerId == null) return true;
    return dragState.pointerId === event.pointerId;
  }

  function removeDragListeners() {
    doc.removeEventListener('pointermove', onDragMove, true);
    doc.removeEventListener('pointerup', onDragEnd, true);
    doc.removeEventListener('pointercancel', onDragEnd, true);
  }

  function finishDrag(shouldSave) {
    if (!dragState) return;
    const state = dragState;
    dragState = null;
    removeDragListeners();
    if (state.handle && state.handle.classList) {
      state.handle.classList.remove('dragging');
    }
    if (state.capture && state.node) {
      try {
        if (
          typeof state.node.releasePointerCapture === 'function' &&
          (typeof state.node.hasPointerCapture !== 'function' ||
            state.node.hasPointerCapture(state.pointerId))
        ) {
          state.node.releasePointerCapture(state.pointerId);
        }
      } catch (_error) {
        // 捕获已失效时忽略。
      }
    }
    if (shouldSave && state.moved) savePositions();
  }

  function onDragMove(event) {
    if (!dragState || !samePointer(event)) return;
    const dx = (Number(event.clientX) || 0) - dragState.startX;
    const dy = (Number(event.clientY) || 0) - dragState.startY;

    if (!dragState.moved) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_THRESHOLD) return;
      dragState.moved = true;
      if (dragState.handle && dragState.handle.classList) {
        dragState.handle.classList.add('dragging');
      }
      if (typeof event.preventDefault === 'function') event.preventDefault();
    }

    if (dragState.kind === 'entry') {
      const size = measure(entry, ENTRY_SIZE);
      entryPos = clampPoint({
        left: dragState.startLeft + dx,
        top: dragState.startTop + dy,
      }, size);
      applyPosition(entry, entryPos);
      if (opened && !panelMoved) positionPanelNearEntry();
    } else {
      const size = measure(panel, panelFallbackSize());
      panelPos = clampPoint({
        left: dragState.startLeft + dx,
        top: dragState.startTop + dy,
      }, size);
      panelMoved = true;
      applyPosition(panel, panelPos);
    }
  }

  function onDragEnd(event) {
    if (!dragState) return;
    if (event && !samePointer(event)) return;
    const kind = dragState.kind;
    const moved = dragState.moved;
    finishDrag(true);
    // 气泡的拖动结束通常会再冒出一个 click，只拦掉气泡自身这一次。
    // 面板标题栏不是按钮，不需要全局吞点击，避免影响关闭/复制。
    if (moved && kind === 'entry') suppressClickOn(entry);
  }

  function beginDrag(kind, node, handle, event, canStart) {
    if (disposed || dragState || !event) return;
    if (event.button != null && event.button !== 0) return;
    if (event.isPrimary === false) return;
    if (canStart && !canStart(event)) return;
    // 新的按下表示用户开始了下一次交互，不再拦旧的拖动点击。
    releaseClickGuard();

    const rect = elementRect(node, kind);
    dragState = {
      kind,
      node,
      handle,
      pointerId: event.pointerId == null ? null : event.pointerId,
      startX: Number(event.clientX) || 0,
      startY: Number(event.clientY) || 0,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false,
      capture: false,
    };

    if (
      event.pointerId != null &&
      typeof node.setPointerCapture === 'function'
    ) {
      try {
        node.setPointerCapture(event.pointerId);
        dragState.capture = true;
      } catch (_error) {
        dragState.capture = false;
      }
    }

    doc.addEventListener('pointermove', onDragMove, true);
    doc.addEventListener('pointerup', onDragEnd, true);
    doc.addEventListener('pointercancel', onDragEnd, true);
  }

  async function runAction(factory) {
    try {
      await factory();
    } catch (error) {
      const message =
        (error && error.message) || '操作失败';
      showFeedback(message, true);
    }
  }

  const onEscape = (event) => {
    if (event && event.key === 'Escape') close();
  };

  function open() {
    if (disposed || opened) return;
    opened = true;
    panel.hidden = false;
    entry.setAttribute('aria-expanded', 'true');
    positionPanel();
    if (typeof doc.addEventListener === 'function') {
      doc.addEventListener('keydown', onEscape, true);
    }

    if (refreshed || typeof controller.refresh !== 'function') return;
    refreshed = true;
    silentRefresh = true;
    Promise.resolve()
      .then(() => controller.refresh())
      .catch(() => {})
      .finally(() => {
        silentRefresh = false;
        if (!disposed) render(controller.getState());
      });
  }

  function close() {
    if (disposed) return;
    opened = false;
    panel.hidden = true;
    entry.setAttribute('aria-expanded', 'false');
    if (typeof doc.removeEventListener === 'function') {
      doc.removeEventListener('keydown', onEscape, true);
    }
  }

  const onEntry = () => {
    if (panel.hidden) open();
    else close();
  };
  const onEntryPointerDown = (event) => {
    beginDrag('entry', entry, entry, event);
  };
  const onHeadPointerDown = (event) => {
    const target = event && event.target;
    if (
      target &&
      typeof target.closest === 'function' &&
      target.closest('button, input, a, summary, label')
    ) {
      return;
    }
    beginDrag('panel', panel, head, event, () => !panel.hidden);
  };
  const onClose = () => close();
  const onCreate = () => {
    runAction(() => controller.create());
  };
  const onJoin = () => {
    const value = joinInput.value.trim();
    if (!value) {
      showFeedback('请先粘贴邀请链接', true);
      joinInput.focus();
      return;
    }
    runAction(async () => {
      await controller.join(value);
      joinInput.value = '';
    });
  };
  const onCopy = () => {
    copyInvite();
  };
  const onFollow = () => {
    runAction(() => controller.setFollowing(followToggle.checked));
  };
  const onLeave = () => {
    if (
      win &&
      typeof win.confirm === 'function' &&
      !win.confirm('确定退出一起听房间？')
    ) {
      return;
    }
    runAction(() => controller.leave());
  };
  const onJoinKey = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onJoin();
    }
  };

  entry.addEventListener('pointerdown', onEntryPointerDown);
  entry.addEventListener('click', onEntry);
  head.addEventListener('pointerdown', onHeadPointerDown);
  panel.addEventListener('keydown', onEscape);
  closeBtn.addEventListener('click', onClose);
  createBtn.addEventListener('click', onCreate);
  joinBtn.addEventListener('click', onJoin);
  joinInput.addEventListener('keydown', onJoinKey);
  copyBtn.addEventListener('click', onCopy);
  followToggle.addEventListener('change', onFollow);
  leaveBtn.addEventListener('click', onLeave);

  parent.appendChild(host);

  readSavedPositions();
  if (entryPos) {
    entryPos = clampPoint(entryPos, measure(entry, ENTRY_SIZE));
    applyPosition(entry, entryPos);
  }
  if (panelMoved && panelPos) {
    // 隐藏时无法准确测量高度，先恢复原位置，打开面板时再 clamp。
    applyPosition(panel, panelPos);
  }

  const view = win || doc.defaultView || null;
  const onBlur = () => finishDrag(true);
  if (view && typeof view.addEventListener === 'function') {
    view.addEventListener('resize', onResize);
    view.addEventListener('blur', onBlur);
  }
  const observer = typeof view?.ResizeObserver === 'function' && new view.ResizeObserver(() => {
    if (opened && !dragState) positionPanel();
  });
  if (observer) observer.observe(panel);

  const unsubscribe = controller.subscribe(render);
  render(controller.getState());
  clampEntry();

  function notify(message, isError = false) {
    showFeedback(message, !!isError);
  }

  return {
    open,
    notify,
    dispose() {
      if (disposed) return;
      clearFeedback();
      releaseClickGuard();
      if (dragState) finishDrag(false);
      close();
      disposed = true;
      if (typeof unsubscribe === 'function') unsubscribe();
      if (view && typeof view.removeEventListener === 'function') {
        view.removeEventListener('resize', onResize);
        view.removeEventListener('blur', onBlur);
      }
      if (observer) observer.disconnect();
      entry.removeEventListener('pointerdown', onEntryPointerDown);
      entry.removeEventListener('click', onEntry);
      head.removeEventListener('pointerdown', onHeadPointerDown);
      panel.removeEventListener('keydown', onEscape);
      closeBtn.removeEventListener('click', onClose);
      createBtn.removeEventListener('click', onCreate);
      joinBtn.removeEventListener('click', onJoin);
      joinInput.removeEventListener('keydown', onJoinKey);
      copyBtn.removeEventListener('click', onCopy);
      followToggle.removeEventListener('change', onFollow);
      leaveBtn.removeEventListener('click', onLeave);
      if (host.parentNode) host.parentNode.removeChild(host);
    },
  };
}

module.exports = { mountRoomPanel };
