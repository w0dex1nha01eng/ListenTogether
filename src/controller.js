'use strict';

const { displayName, trackMetadata } = require('./metadata');

/**
 * 多人一起听控制器。只依赖 adapter 的账号/播放器/固定 envelope 请求。
 * 房间生命周期使用单一 generation，所有异步回调都校验它，避免旧响应污染。
 */

const ROOM_RE = /^[A-Za-z0-9_-]{1,128}$/;
const ID_RE = /^[1-9]\d{0,23}$/;
const SHARE_URL = 'https://st.music.163.com/listen-together/multishare/index.html';

function fail(message, extra) {
  const error = new Error(String(message || '操作失败'));
  if (extra) Object.assign(error, extra);
  return error;
}

function validRoom(value) {
  return typeof value === 'string' && ROOM_RE.test(value);
}

function validId(value) {
  const text = String(value == null ? '' : value);
  return ID_RE.test(text);
}

function validSong(value) {
  const text = String(value == null ? '' : value).trim();
  return ID_RE.test(text) ? text : '';
}

function truthy(value) {
  return value != null && value !== '' && !/^(0|false|no|off)$/i.test(String(value));
}

function messageOf(error, fallback = '操作失败') {
  return String((error && error.message) || fallback);
}

function isGoneBody(body) {
  return !!body && (Number(body.code) === 488 || Number(body.failedCode) === 488);
}

function isGone(error) {
  return !!error && (error.gone || Number(error.code) === 488);
}

function parseInvite(input) {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (!text) return null;

  let url;
  try {
    if (/^orpheus:\/\//i.test(text)) {
      url = new URL(text);
      if (
        url.protocol !== 'orpheus:' ||
        String(url.hostname).toLowerCase() !== 'nm' ||
        String(url.pathname).toLowerCase() !== '/multilistentogether/joinroom'
      ) {
        return null;
      }
    } else if (/^https?:\/\//i.test(text)) {
      url = new URL(text);
      if (
        (url.protocol !== 'https:' && url.protocol !== 'http:') ||
        String(url.hostname).toLowerCase() !== 'st.music.163.com' ||
        url.pathname !== '/listen-together/multishare/index.html'
      ) {
        return null;
      }
    } else {
      return null;
    }
    if (url.username || url.password || url.port) return null;
  } catch (_error) {
    return null;
  }

  const roomId =
    url.searchParams.get('roomId') || url.searchParams.get('room_id') || '';
  const inviterUid =
    url.searchParams.get('inviterUid') ||
    url.searchParams.get('inviter_uid') ||
    url.searchParams.get('inviterId') ||
    url.searchParams.get('inviter_id') ||
    '';
  if (!validRoom(roomId) || !validId(inviterUid)) return null;
  if (truthy(url.searchParams.get('isFLT'))) return null;

  return {
    roomId,
    inviterUid: String(inviterUid),
    inviterId: String(inviterUid),
    multi: true,
    isFLT: false,
  };
}

function buildInvite(init, maybeInviterUid) {
  const source = init && typeof init === 'object' ? init : null;
  const roomId = String(source ? source.roomId : init == null ? '' : init);
  const inviterUid = String(
    source
      ? source.inviterUid || source.inviterId || source.inviter_uid || ''
      : maybeInviterUid == null
        ? ''
        : maybeInviterUid
  );
  if (!validRoom(roomId) || !validId(inviterUid)) return '';
  if (source && truthy(source.isFLT)) return '';

  const params = new URLSearchParams();
  params.set('roomId', roomId);
  params.set('inviterUid', inviterUid);
  params.set('app_version', '9.5.70');
  params.set('dlt', '0846');
  params.set('isFLT', 'false');
  return `${SHARE_URL}?${params.toString()}`;
}

function normalizeInvite(input) {
  if (typeof input === 'string') return parseInvite(input);
  if (!input || typeof input !== 'object' || truthy(input.isFLT)) return null;
  const roomId = String(input.roomId || '');
  const inviterUid = String(
    input.inviterUid || input.inviterId || input.inviter_uid || ''
  );
  if (!validRoom(roomId) || !validId(inviterUid)) return null;
  return { roomId, inviterUid, inviterId: inviterUid, multi: true, isFLT: false };
}

function serviceMessage(body, fallback) {
  const message = body?.failedMessage || body?.message || body?.msg;
  if (typeof message !== 'string' || !/[\u3400-\u9fff]/.test(message) ||
      /https?:\/\/|orpheus:\/\/|\b[a-f0-9]{24,}\b|\{.*\}/i.test(message)) return fallback;
  return message.replace(/[（(]\s*\d+\s*[)）]/g, '').trim() || fallback;
}

function unwrap(response) {
  if (!response || typeof response !== 'object') {
    throw fail('服务器返回异常');
  }
  const code = Number(response.code);
  if (code === 488) {
    throw fail('房间已结束或不存在', { code: 488, gone: true });
  }
  if (code !== 200) {
    throw fail(
      serviceMessage(response, '请求失败，请稍后重试'),
      { code: Number.isFinite(code) ? code : 0 }
    );
  }
  return response.data && typeof response.data === 'object'
    ? response.data
    : {};
}

function lifecycleOk(body, fallback) {
  if (isGoneBody(body)) throw fail('房间已结束或不存在', { gone: true });
  if (!body || body.success !== true) {
    throw fail(serviceMessage(body, fallback));
  }
}

function operateOk(body, fallback) {
  if (isGoneBody(body)) throw fail('房间已结束或不存在', { gone: true });
  if (!body || body.success === false || body.result === false) {
    throw fail(serviceMessage(body, fallback));
  }
  if (body.failedCode !== undefined && Number(body.failedCode) !== 0) {
    throw fail(serviceMessage(body, fallback));
  }
}

function snapshotOf(body) {
  return (body && body.multiLtRoomSnapshot) || null;
}

function roomIdOf(body, snapshot) {
  for (const value of [body?.roomId, snapshot?.roomId, snapshot?.multiRoomInfoDTO?.roomId]) {
    const id = String(value == null ? '' : value);
    if (validRoom(id)) return id;
  }
  return '';
}

function ownerOf(snapshot, body) {
  for (const value of [snapshot?.multiRoomInfoDTO?.creatorId, snapshot?.creatorId,
    snapshot?.creatorUid, snapshot?.roomInfo?.creatorId, body?.creatorId]) {
    if (validId(value)) return String(value);
  }
  return '';
}

function inviterOf(snapshot, body) {
  for (const value of [
    ownerOf(snapshot, body),
    snapshot && snapshot.inviterUid,
    body && body.inviterUid,
  ]) {
    const id = String(value == null ? '' : value);
    if (validId(id)) return id;
  }
  return '';
}

function playInfoOf(body, snapshot) {
  const raw =
    (body && body.roomPlaySongInfo) ||
    (snapshot && snapshot.roomPlaySongInfo);
  if (!raw || typeof raw !== 'object') return null;

  const song = raw.playSong && typeof raw.playSong === 'object'
    ? raw.playSong
    : {};
  const songId = validSong(song.songId || song.id || raw.songId);
  const nextSongs = queueOf(raw.nextSongs);
  if (!songId && !nextSongs) return null;

  const played = Number(raw.playedTime);
  const duration = Number(raw.songDuration);
  const version = Number(raw.version);
  return {
    songId,
    positionMs: Number.isFinite(played) && played > 0 ? played : 0,
    durationMs: Number.isFinite(duration) && duration > 0 ? duration : 0,
    version: Number.isFinite(version) ? version : null,
    ...trackMetadata(song, songId),
    nextSongs,
  };
}

function queueOf(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const queue = [];
  for (const item of list) {
    if (item == null) continue;
    const rawId = typeof item === 'object'
      ? item.songId || item.id
      : item;
    const songId = validSong(rawId);
    if (!songId || seen.has(songId)) continue;
    seen.add(songId);
    queue.push({
      songId,
      ...trackMetadata(item, songId),
    });
  }
  return queue;
}

function createRoomController(adapter, options = {}) {
  if (!adapter || typeof adapter.request !== 'function') {
    throw new TypeError('createRoomController 需要 adapter.request');
  }

  const clock = options.clock || {};
  const now =
    typeof options.now === 'function'
      ? options.now
      : typeof clock.now === 'function'
        ? () => clock.now()
        : () => Date.now();
  const setTimer =
    typeof options.setTimeout === 'function'
      ? options.setTimeout
      : typeof clock.setTimeout === 'function'
        ? (fn, ms) => clock.setTimeout(fn, ms)
        : (fn, ms) => setTimeout(fn, ms);
  const clearTimer =
    typeof options.clearTimeout === 'function'
      ? options.clearTimeout
      : typeof clock.clearTimeout === 'function'
        ? (id) => clock.clearTimeout(id)
        : (id) => clearTimeout(id);

  const numberOption = (value, fallback) =>
    Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : fallback;
  const autoPoll = options.autoPoll !== false;
  const heartbeatMs = numberOption(options.heartbeatIntervalMs, 8000);
  const statusMs = numberOption(options.statusIntervalMs, 15000);
  const readyTimeoutMs = numberOption(options.playConfirmTimeoutMs, 6000);
  const readyIntervalMs = numberOption(options.playConfirmIntervalMs, 250);
  const toleranceMs = numberOption(options.progressToleranceMs, 1800);

  const listeners = new Set();
  const timers = { heartbeat: null, status: null };
  let disposed = false;
  let generation = 0;
  let polling = false;
  let lastVersion = -1;
  let heartbeatPending = null;
  let statusPending = null;
  let refreshPending = null;
  let followPromise = null;
  let followAgain = false;
  let actionName = '';
  let actionPromise = null;
  const trackDetails = new Map();
  const trackRetryAt = new Map();
  let ownerRetryAt = 0;

  let state = {
    status: 'idle',
    busy: '',
    error: '',
    notice: '',
    accountId: '',
    roomId: '',
    inviterUid: '',
    isOwner: false,
    roomOwnerId: '',
    roomOwnerName: '',
    following: true,
    members: [],
    queue: [],
    playback: null,
    roomPlayback: null,
    inviteLink: '',
    lastSyncAt: 0,
    lastHeartbeatAt: 0,
    heartbeatFailures: 0,
    syncError: '',
  };

  const active = (gen, roomId) =>
    !disposed && gen === generation && !!roomId && roomId === state.roomId;

  function getState() {
    return {
      ...state,
      inRoom: !!state.roomId,
      members: state.members.map((item) => ({ ...item })),
      queue: state.queue.map((item) => ({ ...item })),
      playback: state.playback ? { ...state.playback } : null,
      roomPlayback: state.roomPlayback ? { ...state.roomPlayback } : null,
    };
  }

  function emit() {
    if (disposed || listeners.size === 0) return;
    const snapshot = getState();
    for (const listener of Array.from(listeners)) {
      try {
        listener(snapshot);
      } catch (_error) {
        // UI listener failures must not break room state.
      }
    }
  }

  function setState(patch, notify = true) {
    state = { ...state, ...patch };
    if (notify) emit();
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function clearTimers() {
    polling = false;
    for (const kind of Object.keys(timers)) {
      if (timers[kind] != null) {
        clearTimer(timers[kind]);
        timers[kind] = null;
      }
    }
  }

  function arm(kind, milliseconds, run) {
    if (!polling || disposed || !state.roomId) return;
    if (timers[kind] != null) clearTimer(timers[kind]);
    const gen = generation;
    const roomId = state.roomId;
    timers[kind] = setTimer(() => {
      timers[kind] = null;
      if (!active(gen, roomId)) return;
      Promise.resolve()
        .then(run)
        .catch(() => {})
        .finally(() => {
          if (active(gen, roomId)) arm(kind, milliseconds, run);
        });
    }, milliseconds);
  }

  function startPolling() {
    clearTimers();
    if (!autoPoll || disposed || !state.roomId) return;
    polling = true;
    arm('heartbeat', heartbeatMs, pollHeartbeat);
    arm('status', statusMs, pollStatus);
  }

  async function requireAccount() {
    let raw;
    try {
      raw = await adapter.getAccount();
    } catch (error) {
      setState({ accountId: '' });
      throw fail(messageOf(error, '无法读取网易云账号'));
    }
    const accountId = String(raw == null ? '' : raw).trim();
    if (!validId(accountId)) {
      setState({ accountId: '' });
      throw fail('请先在网易云原客户端登录');
    }
    if (accountId !== state.accountId) setState({ accountId });
    return accountId;
  }

  async function readPlayback() {
    let playback;
    try {
      playback = await adapter.getPlayback();
    } catch (_error) {
      return null;
    }
    if (!playback || typeof playback !== 'object') return null;
    const songId = validSong(playback.songId);
    if (!songId) return null;
    const position = Number(playback.positionMs);
    return {
      songId,
      positionMs: Number.isFinite(position) && position > 0 ? position : 0,
      playing: !!playback.playing,
      loading: !!playback.loading,
      ...trackMetadata(playback, songId),
    };
  }

  function applySnapshot(snapshot, roomId, accountId) {
    if (!snapshot || typeof snapshot !== 'object') return;
    const snapshotRoomId = roomIdOf(null, snapshot);
    if (snapshotRoomId && roomId && snapshotRoomId !== roomId) return;

    const dto = snapshot.multiRoomInfoDTO || snapshot.roomInfo;
    const users = snapshot.multiLtRoomUserAgg?.onlineUserInfos ?? dto?.roomUsers;
    if (Array.isArray(users)) {
      state.members = users
        .map(user => {
          const uid = String(user?.userId ?? user?.uid ?? '');
          return { uid, name: displayName(user?.nickname ?? user?.name, uid) };
        })
        .filter((user) => user.uid);
    }

    const owner = ownerOf(snapshot) || state.roomOwnerId;
    if (owner && owner !== state.roomOwnerId) {
      state.roomOwnerId = owner;
      state.roomOwnerName = '';
      ownerRetryAt = 0;
    }
    if (owner) {
      state.isOwner = owner === accountId;
      state.roomOwnerName = displayName(dto?.creatorNickname ?? snapshot.creatorNickname, owner) ||
        state.members.find(user => user.uid === owner)?.name || state.roomOwnerName;
    }

    const inviter = inviterOf(snapshot);
    if (inviter) {
      state.inviterUid = inviter;
      const link = buildInvite(roomId, inviter);
      if (link) state.inviteLink = link;
    }

  }

  function mergeTrack(track) {
    const cached = trackDetails.get(track.songId);
    const title = cached?.title || track.title;
    const artist = cached?.artist || track.artist;
    if (title || artist) trackDetails.set(track.songId, { title, artist });
    return { ...track, title, artist };
  }

  function loadTrackDetails(gen, roomId, tracks, time) {
    if (typeof adapter.getTrackMetadata !== 'function') return;
    if (trackRetryAt.size > 256 || trackDetails.size > 256) {
      const currentIds = new Set(tracks.map(track => track.songId));
      for (const cache of [trackRetryAt, trackDetails]) {
        for (const id of cache.keys()) if (!currentIds.has(id)) cache.delete(id);
      }
    }
    const ids = [...new Set(tracks.filter(track => (!track.title || !track.artist) &&
      (trackRetryAt.get(track.songId) ?? -1) <= time).map(track => track.songId))].slice(0, 100);
    if (!ids.length) return;
    const requested = new Set(ids);
    for (const id of ids) trackRetryAt.set(id, time + 45000);
    Promise.resolve().then(() => active(gen, roomId) && adapter.getTrackMetadata(ids)).then(results => {
      if (!active(gen, roomId) || !Array.isArray(results)) return;
      for (const track of results) {
        if (!requested.has(track?.songId)) continue;
        const { title, artist } = trackMetadata(track, track.songId);
        const previous = trackDetails.get(track.songId);
        trackDetails.set(track.songId, { title: title || previous?.title, artist: artist || previous?.artist });
      }
      setState({
        roomPlayback: state.roomPlayback && mergeTrack(state.roomPlayback),
        queue: state.queue.map(mergeTrack),
      });
    }).catch(() => {});
  }

  function loadRoomMetadata() {
    const { roomId, roomPlayback, queue, roomOwnerId } = state;
    const gen = generation;
    if (!active(gen, roomId)) return;
    const time = now();
    loadTrackDetails(gen, roomId, [roomPlayback, ...queue].filter(Boolean), time);
    if (!roomOwnerId || state.roomOwnerName || time < ownerRetryAt || typeof adapter.getRoomOwnerName !== 'function') return;
    ownerRetryAt = time + 45000;
    Promise.resolve().then(() => active(gen, roomId) && adapter.getRoomOwnerName(roomOwnerId)).then(value => {
      const name = displayName(value, roomOwnerId);
      if (name && active(gen, roomId) && state.roomOwnerId === roomOwnerId && !state.roomOwnerName) {
        setState({ roomOwnerName: name });
      }
    }).catch(() => {});
  }

  function resetRoomMetadata() {
    trackDetails.clear();
    trackRetryAt.clear();
    ownerRetryAt = 0;
  }

  function applyPlayInfo(info) {
    if (!info) return false;
    const sampledAt = now();
    if (!info.songId) {
      if (info.nextSongs) state.queue = info.nextSongs.map(mergeTrack);
      state.lastSyncAt = sampledAt;
      return false;
    }
    if (info.version != null) {
      if (lastVersion >= 0 && info.version < lastVersion) return false;
      lastVersion = info.version;
    }
    state.roomPlayback = mergeTrack({
      songId: info.songId,
      positionMs: info.positionMs,
      durationMs: info.durationMs,
      version: info.version,
      title: info.title,
      artist: info.artist,
      sampledAt,
    });
    if (info.nextSongs) state.queue = info.nextSongs.map(mergeTrack);
    state.lastSyncAt = sampledAt;
    return true;
  }

  function consume(body, roomId) {
    const snapshot = snapshotOf(body);
    const snapshotRoomId = snapshot ? roomIdOf(null, snapshot) : '';
    const usable =
      snapshot && (!snapshotRoomId || snapshotRoomId === roomId)
        ? snapshot
        : null;
    if (usable) applySnapshot(usable, roomId, state.accountId);
    applyPlayInfo(playInfoOf(body, usable));
    loadRoomMetadata();
  }

  function enterRoom({ roomId, inviterUid, ownerId, body, accountId, notice }) {
    generation += 1;
    clearTimers();
    lastVersion = -1;
    followAgain = false;
    resetRoomMetadata();
    state = {
      ...state,
      status: 'joined',
      error: '',
      notice,
      accountId: accountId || state.accountId,
      roomId,
      inviterUid: String(inviterUid || ''),
      isOwner: Boolean(ownerId && ownerId === accountId),
      roomOwnerId: ownerId || '',
      roomOwnerName: '',
      following: true,
      members: [],
      queue: [],
      roomPlayback: null,
      inviteLink:
        buildInvite(roomId, inviterUid || accountId || state.accountId) || '',
      lastSyncAt: 0,
      lastHeartbeatAt: 0,
      heartbeatFailures: 0,
      syncError: '',
    };
    consume(body, roomId);
    emit();
    startPolling();
    kickFollow();
    if (!snapshotOf(body) && polling) void pollStatus();
  }

  function endRoom(notice) {
    generation += 1;
    clearTimers();
    lastVersion = -1;
    followAgain = false;
    resetRoomMetadata();
    state = {
      ...state,
      status: 'idle',
      error: '',
      notice: notice || '',
      roomId: '',
      inviterUid: '',
      isOwner: false,
      roomOwnerId: '',
      roomOwnerName: '',
      following: true,
      members: [],
      queue: [],
      roomPlayback: null,
      inviteLink: '',
      lastSyncAt: 0,
      lastHeartbeatAt: 0,
      heartbeatFailures: 0,
      syncError: '',
    };
    emit();
  }

  function exclusive(name, fn, status) {
    if (actionName) {
      if (actionName === name && name !== 'operate' && actionPromise) return actionPromise;
      return Promise.reject(fail('上一个操作尚未完成'));
    }
    actionName = name;
    const patch = { busy: name, error: '', notice: '' };
    if (status) patch.status = status;
    setState(patch);

    actionPromise = (async () => {
      try {
        return await fn();
      } catch (error) {
        if (disposed) throw error;
        if (isGone(error) && state.roomId) {
          endRoom('房间已结束');
        } else {
          setState({
            error: messageOf(error),
            status: state.roomId ? 'joined' : 'idle',
          });
        }
        throw error;
      } finally {
        actionName = '';
        actionPromise = null;
        if (!disposed) setState({ busy: '' });
      }
    })();
    return actionPromise;
  }

  function create() {
    return exclusive('create', async () => {
      if (state.roomId) throw fail('已在房间中，请先退出');
      const accountId = await requireAccount();
      const playback = await readPlayback();
      if (!playback || playback.loading) throw fail('尚未加载到可播放的当前歌曲');
      setState({ playback });

      const body = unwrap(await adapter.request('create', {
        songId: playback.songId,
      }));
      if (disposed) throw fail('已停用', { cancelled: true });
      lifecycleOk(body, '创建房间失败');

      const snapshot = snapshotOf(body);
      const roomId = roomIdOf(body, snapshot);
      if (!roomId) throw fail('无法确认房间已创建，请重试');
      enterRoom({
        roomId,
        inviterUid: accountId,
        ownerId: ownerOf(snapshot, body) || accountId,
        body,
        accountId,
        notice: '房间已创建',
      });
      return getState();
    }, 'connecting');
  }

  function join(input) {
    const invite = normalizeInvite(input);
    if (!invite) {
      const error = fail('邀请链接无效，请粘贴网易云多人一起听邀请链接');
      setState({ error: error.message, notice: '' });
      return Promise.reject(error);
    }

    return exclusive('join', async () => {
      if (state.roomId) throw fail('已在房间中，请先退出');
      const accountId = await requireAccount();
      const body = unwrap(await adapter.request('join', {
        roomId: invite.roomId,
        inviterUid: invite.inviterUid,
      }));
      if (disposed) throw fail('已停用', { cancelled: true });
      lifecycleOk(body, '加入房间失败');

      const snapshot = snapshotOf(body);
      const responseRoomIds = [body.roomId, snapshot?.roomId, snapshot?.multiRoomInfoDTO?.roomId]
        .map((value) => String(value == null ? '' : value))
        .filter(validRoom);
      if (responseRoomIds.length === 0) {
        throw fail('无法确认已加入房间，请重试');
      }
      if (responseRoomIds.some((id) => id !== invite.roomId)) {
        throw fail('加入房间响应与邀请链接不一致');
      }

      const inviter = inviterOf(snapshot, body) || invite.inviterUid;
      enterRoom({
        roomId: invite.roomId,
        inviterUid: inviter,
        ownerId: ownerOf(snapshot, body),
        body,
        accountId,
        notice: '已加入房间',
      });
      return getState();
    }, 'connecting');
  }

  function leave() {
    if (!state.roomId) {
      setState({ notice: '当前未加入房间', error: '' });
      return Promise.resolve(getState());
    }

    return exclusive('leave', async () => {
      const gen = generation;
      const roomId = state.roomId;
      let response;
      try {
        response = await adapter.request('leave', { roomId });
      } catch (error) {
        if (!active(gen, roomId)) return getState();
        if (isGone(error)) {
          endRoom('房间已结束');
          return getState();
        }
        throw error;
      }
      if (!active(gen, roomId)) return getState();

      let body;
      try {
        body = unwrap(response);
      } catch (error) {
        if (isGone(error)) {
          endRoom('房间已结束');
          return getState();
        }
        throw error;
      }
      if (isGoneBody(body)) {
        endRoom('房间已结束');
        return getState();
      }
      lifecycleOk(body, '退出房间失败');
      endRoom('已退出房间');
      return getState();
    }, 'leaving');
  }

  function recommendTrack(selected) {
    return exclusive('operate', async () => {
      const gen = generation;
      const roomId = state.roomId;
      if (!roomId) throw fail('当前未加入房间');
      const roomAccount = state.accountId;
      const account = await requireAccount();
      if (!active(gen, roomId)) throw fail('房间已变更', { cancelled: true });
      if (account !== roomAccount) {
        endRoom();
        throw fail('账号已切换，请重新加入房间');
      }
      const track = selected || await readPlayback();
      if (!active(gen, roomId)) throw fail('房间已变更', { cancelled: true });
      const songId = validSong(track?.songId);
      if (!songId) throw fail(selected ? '歌曲不可推荐' : '尚未加载到当前歌曲');
      if (!selected) setState({ playback: track });

      const body = unwrap(await adapter.request('operate', {
        roomId,
        songId,
      }));
      if (!active(gen, roomId)) throw fail('房间已变更', { cancelled: true });
      operateOk(body, '推荐歌曲失败');

      const queue = state.queue.filter(item => item.songId !== songId);
      queue.push(mergeTrack({ songId, ...trackMetadata(track, songId) }));
      setState({
        queue,
        notice: selected ? '已推荐' : '已推送当前歌曲',
        error: '',
        lastSyncAt: now(),
      });
      loadRoomMetadata();
      return getState();
    });
  }

  function recommend(track) {
    return recommendTrack(track || {});
  }

  function pushCurrent() {
    return recommendTrack();
  }

  async function pollHeartbeat() {
    if (!state.roomId || disposed) return getState();
    if (heartbeatPending) return heartbeatPending;

    const gen = generation;
    const roomId = state.roomId;
    heartbeatPending = (async () => {
      try {
        const body = unwrap(
          await adapter.request('heartbeat', { roomId })
        );
        if (!active(gen, roomId)) return getState();
        if (isGoneBody(body)) {
          endRoom('房间已结束');
          return getState();
        }
        const responseRoomId = roomIdOf(body, snapshotOf(body));
        if (responseRoomId && responseRoomId !== roomId) return getState();

        consume(body, roomId);
        const hadFailures = state.heartbeatFailures > 0;
        const timestamp = now();
        state = {
          ...state,
          heartbeatFailures: 0,
          lastHeartbeatAt: timestamp,
          lastSyncAt: timestamp,
        };
        if (hadFailures) state.error = '';
        emit();
        await kickFollow();
      } catch (error) {
        if (!active(gen, roomId)) return getState();
        if (isGone(error)) {
          endRoom('房间已结束');
          return getState();
        }
        setState({
          heartbeatFailures: state.heartbeatFailures + 1,
          error: `心跳失败：${messageOf(error)}`,
        });
      } finally {
        heartbeatPending = null;
      }
      return getState();
    })();
    return heartbeatPending;
  }

  async function pollStatus() {
    if (!state.roomId || disposed) return getState();
    if (statusPending) return statusPending;

    const gen = generation;
    const roomId = state.roomId;
    statusPending = (async () => {
      try {
        const body = unwrap(await adapter.request('status', {}));
        if (!active(gen, roomId)) return getState();
        if (isGoneBody(body)) {
          endRoom('房间已结束');
          return getState();
        }
        const responseRoomId = roomIdOf(body, snapshotOf(body));
        if (responseRoomId && responseRoomId !== roomId) return getState();

        consume(body, roomId);
        setState({ lastSyncAt: now() });
        await kickFollow();
      } catch (error) {
        if (active(gen, roomId) && isGone(error)) endRoom('房间已结束');
      } finally {
        statusPending = null;
      }
      return getState();
    })();
    return statusPending;
  }

  async function refresh() {
    if (refreshPending) return refreshPending;

    const gen = generation;
    refreshPending = (async () => {
      try {
        const accountId = await requireAccount();
        if (disposed || generation !== gen) return getState();
        const body = unwrap(await adapter.request('status', {}));
        if (disposed || generation !== gen) return getState();

        const snapshot = snapshotOf(body);
        const roomId = roomIdOf(body, snapshot);
        if (roomId) {
          if (!state.roomId || roomId !== state.roomId) {
            const owner = ownerOf(snapshot, body);
            const inviterUid = inviterOf(snapshot, body) || accountId;
            enterRoom({
              roomId,
              inviterUid,
              ownerId: owner,
              body,
              accountId,
              notice: '已恢复房间',
            });
            return getState();
          }
          consume(body, roomId);
          setState({
            status: 'joined',
            error: '',
            notice: '已恢复房间',
            accountId,
          });
          if (!polling) startPolling();
          await kickFollow();
          return getState();
        }

        if (body.status === 'RECONNECT_SUCCESS' && state.roomId) {
          setState({
            status: 'joined',
            error: '',
            notice: '已恢复房间',
            accountId,
          });
        } else if (!state.roomId) {
          setState({
            accountId,
            status: 'idle',
            error: '',
            notice: '未发现可恢复的房间',
          });
        } else {
          consume(body, state.roomId);
          setState({ accountId, lastSyncAt: now() });
          await kickFollow();
        }
        return getState();
      } catch (error) {
        if (disposed) return getState();
        if (isGone(error)) {
          if (state.roomId) endRoom('房间已结束');
          else {
            setState({
              status: 'idle',
              error: '',
              notice: '未发现可恢复的房间',
            });
          }
        } else {
          setState({
            error: messageOf(error),
            status: state.roomId ? 'joined' : 'idle',
          });
        }
        return getState();
      } finally {
        refreshPending = null;
      }
    })();
    return refreshPending;
  }

  async function setFollowing(value) {
    const following = !(
      value === false || value === 0 || value === '0' || value === 'false'
    );
    setState({ following });
    if (!following) {
      followAgain = false;
      return getState();
    }
    if (!state.roomId || disposed) return getState();

    await pollHeartbeat();
    if (state.roomId && !disposed) await kickFollow();
    return getState();
  }

  function targetMs(info) {
    if (!info || !info.songId) return 0;
    let target = Number(info.positionMs) || 0;
    const sampledAt = Number(info.sampledAt);
    target += Math.max(0, now() - (Number.isFinite(sampledAt) ? sampledAt : now()));
    if (info.durationMs > 0) {
      target = Math.min(target, Math.max(0, info.durationMs - 100));
    }
    return Math.max(0, Math.round(target));
  }

  function kickFollow() {
    if (disposed || !state.roomId || !state.following) {
      return Promise.resolve(getState());
    }
    if (followPromise) {
      followAgain = true;
      return followPromise;
    }

    const gen = generation;
    const roomId = state.roomId;
    followPromise = (async () => {
      try {
        do {
          followAgain = false;
          if (!active(gen, roomId) || !state.following) break;
          await followOnce(gen, roomId);
        } while (followAgain && active(gen, roomId) && state.following);
      } catch (error) {
        if (active(gen, roomId) && !error.cancelled) {
          setState({ syncError: messageOf(error, '跟随同步失败') });
        }
      } finally {
        followPromise = null;
        if (followAgain && active(gen, roomId) && state.following) {
          kickFollow();
        }
      }
    })();
    return followPromise;
  }

  async function followOnce(gen, roomId) {
    const roomPlayback = state.roomPlayback;
    if (!roomPlayback || !roomPlayback.songId) return;
    if (!state.following) throw fail('已暂停跟随', { cancelled: true });

    let local = await readPlayback();
    if (!active(gen, roomId) || !state.following) {
      throw fail('已停止跟随', { cancelled: true });
    }

    let latest = state.roomPlayback;
    if (!latest || latest.songId !== roomPlayback.songId) return;

    if (!local || local.songId !== roomPlayback.songId) {
      await adapter.play(roomPlayback.songId);
      if (!active(gen, roomId) || !state.following) {
        throw fail('已停止跟随', { cancelled: true });
      }
      local = await waitForSong(gen, roomId, roomPlayback.songId);
      if (!active(gen, roomId) || !state.following) {
        throw fail('已停止跟随', { cancelled: true });
      }
      latest = state.roomPlayback;
      if (!latest || latest.songId !== roomPlayback.songId) return;

      const target = targetMs(latest);
      await adapter.seek(target);
      if (!active(gen, roomId) || !state.following) return;
      setState({
        playback: { ...local, positionMs: target },
        syncError: '',
        lastSyncAt: now(),
      });
      return;
    }

    const target = targetMs(latest);
    if (Math.abs((local.positionMs || 0) - target) <= toleranceMs) return;
    await adapter.seek(target);
    if (!active(gen, roomId) || !state.following) return;
    setState({
      playback: { ...local, positionMs: target },
      syncError: '',
      lastSyncAt: now(),
    });
  }

  async function waitForSong(gen, roomId, songId) {
    const attempts =
      readyIntervalMs > 0
        ? Math.max(1, Math.ceil(readyTimeoutMs / readyIntervalMs) + 1)
        : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (!active(gen, roomId) || !state.following) {
        throw fail('已停止跟随', { cancelled: true });
      }
      const playback = await readPlayback();
      if (playback && playback.songId === songId && !playback.loading) {
        return playback;
      }
      if (attempt === attempts - 1) break;
      await new Promise((resolve) => setTimer(resolve, readyIntervalMs));
    }
    throw fail('播放器加载歌曲超时');
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    clearTimers();
    listeners.clear();
    followAgain = false;
  }

  return {
    getState,
    subscribe,
    refresh,
    create,
    join,
    leave,
    pushCurrent,
    recommend,
    setFollowing,
    dispose,
  };
}

module.exports = {
  createRoomController,
  parseInvite,
  buildInvite,
};
