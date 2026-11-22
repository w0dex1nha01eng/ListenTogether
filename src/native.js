'use strict';

const { mountTrackMenu } = require('./track-menu');
const { displayName, trackMetadata } = require('./metadata');

const ROOT = '/api/listen/together/multi/';
const operations = Object.freeze({
  create: { path: 'room/create', needsToken: true },
  join: { path: 'match/ack', needsToken: true },
  status: { path: 'match/status/get' },
  heartbeat: { path: 'match/heartbeat' },
  operate: { path: 'match/song/operate', needsToken: true },
  leave: { path: 'match/exit' },
});
const idPattern = /^[1-9]\d{0,23}$/;
const roomPattern = /^[a-zA-Z0-9_-]{1,128}$/;

function positiveId(value, label) {
  const id = String(value ?? '');
  if (!idPattern.test(id)) throw new Error(label + '无效');
  return id;
}

function payloadFor(name, params = {}) {
  if (name === 'status') return {};
  if (name === 'create') {
    return {
      songId: positiveId(params.songId, '歌曲'),
      type: 1,
      groupIds: '[]',
      inviteUids: '[]',
      from: 'CREATE',
      playedTime: 0,
      nextSongIds: '[]',
    };
  }

  const roomId = String(params.roomId ?? '');
  if (!roomPattern.test(roomId)) throw new Error('房间号无效');
  if (name === 'join') {
    return { roomId, inviterUid: positiveId(params.inviterUid, '邀请人'), agree: true };
  }
  if (name === 'operate') {
    return { roomId, songId: positiveId(params.songId, '歌曲'), operate: 1, bizId: 0 };
  }
  if (name === 'leave') return { roomId, exitType: 'NORMAL_END' };
  return { roomId };
}

function webpackRequire(client) {
  const chunks = client.webpackJsonp;
  if (!Array.isArray(chunks) || chunks.push === Array.prototype.push) {
    throw new Error('网易云主界面尚未就绪，请稍后重试');
  }

  let loadModule;
  const probe = 'ncm-listen-together-' + Math.random().toString(36).slice(2);
  chunks.push([[probe], {
    [probe](_module, _exports, load) {
      loadModule = load;
    },
  }, [[probe]]]);
  if (typeof loadModule !== 'function' || !loadModule.m) {
    throw new Error('当前网易云的模块加载器与插件不兼容');
  }
  return loadModule;
}

function findCapability(load, candidates, signatures, getExport, description) {
  const moduleIds = new Set([...candidates.map(String), ...Object.keys(load.m)]);
  for (const id of moduleIds) {
    const factory = load.m[id];
    if (typeof factory !== 'function') continue;
    const source = Function.prototype.toString.call(factory);
    if (!signatures.every(signature => source.includes(signature))) continue;
    try {
      const result = getExport(load(id));
      if (result) return result;
    } catch {
      // This candidate may be from a chunk whose dependencies are not ready.
    }
  }
  throw new Error('当前网易云版本无法使用' + description);
}

function withTimeout(run, milliseconds, message) {
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([Promise.resolve().then(run), deadline]).finally(() => clearTimeout(timeout));
}

function getAccountFrom(store) {
  const uid = String(store?.host?.uid ?? '');
  return idPattern.test(uid) ? uid : '';
}

function createNativeAdapter(client) {
  let load;
  let storeTool;
  let requestFactory;
  let position;
  let loadTracks;
  let loadProfile;
  let checkTokenTool;
  const getLoad = () => load || (load = webpackRequire(client));
  const find = (ids, signatures, getExport, label) =>
    findCapability(getLoad(), ids, signatures, getExport, label);

  function getStoreTool() {
    return storeTool || (storeTool = find([7, 8], ['getStore', 'getDispatch'], exports => {
      const candidate = exports?.a;
      if (typeof candidate?.getStore === 'function' && typeof candidate?.getDispatch === 'function') {
        return candidate;
      }
    }, '原版账号与播放状态'));
  }

  function state() {
    const tool = getStoreTool();
    if (tool.inited === false) throw new Error('网易云主界面尚未就绪，请稍后重试');
    return tool.getStore();
  }

  function dispatch(type, payload) {
    return getStoreTool().getDispatch()({ type, payload });
  }

  function currentPosition() {
    const observable = position || (position = find([110, 109],
      ['BehaviorSubject', 'playing/setPlayingPosition'], exports => {
        const candidate = exports?.b;
        if (typeof candidate?.getValue === 'function' && typeof candidate.getValue() === 'number') {
          return candidate;
        }
      }, '原版播放器进度'));
    const seconds = observable.getValue();
    return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;
  }

  function getPlayback() {
    const playing = state()?.playing;
    if (!playing) throw new Error('原版播放器尚未就绪');
    const id = String(playing.resourceTrackId ?? '');
    const loading = Boolean(playing.isLoadingFirst);
    const current = playing.curPlaying?.track;
    const metadata = trackMetadata(current?.id != null && String(current.id) !== id ? null : current, id);
    return {
      songId: idPattern.test(id) ? id : '',
      title: metadata.title || displayName(playing.resourceName, id),
      artist: metadata.artist,
      positionMs: currentPosition(),
      playing: playing.playingState === 2,
      loading,
    };
  }

  function getTracks() {
    return loadTracks || (loadTracks = find([120], ['getStore', 'Promise.all', '.flat('],
      exports => typeof exports?.a === 'function' && typeof exports?.b === 'function' && exports.a,
      '原版歌曲详情'));
  }

  async function nativeCheckToken() {
    const tool = checkTokenTool || (checkTokenTool = find([254], ['initWatchman', '.getToken('],
      exports => typeof exports?.a === 'function' && typeof exports?.b === 'function' && exports,
      '客户端的官方请求校验'));
    return withTimeout(async () => {
      if (!client.WM) await tool.a();
      for (let attempt = 0; !client.WM && attempt < 12; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 125));
      }
      const token = await tool.b();
      if (typeof token !== 'string' || !token.trim()) {
        throw new Error('原版客户端未提供请求校验，请稍后重试');
      }
      return token;
    }, 7000, '原版客户端请求校验超时，请稍后重试');
  }

  return {
    installTrackMenu(onRecommend) {
      const template = find([622], ['action_id', 'disableImagePath', 'menuPayload'], exports => {
        const candidate = exports?.c?.('track');
        if (Array.isArray(candidate?.content) &&
          candidate.content.some(item => item?.action_id === 'nextPlay')) return candidate;
      }, '歌曲菜单');
      const bridge = find([4], ['winhelper.popupMenu', 'appendRegisterCall'], exports => {
        const candidate = exports?.Bridge;
        if (typeof candidate?.appendRegisterCall === 'function' &&
          typeof candidate?.removeRegisterCall === 'function') return candidate;
      }, '歌曲菜单事件');
      return mountTrackMenu(template, bridge, onRecommend);
    },

    getAccount() {
      return getAccountFrom(state());
    },

    getPlayback,

    async getTrackMetadata(ids) {
      const tracks = await withTimeout(() => getTracks()(ids.map(id => ({ id, v: 0 }))),
        7000, '歌曲信息加载超时');
      return (tracks || []).map(track => {
        const songId = String(track?.id ?? '');
        return { songId, ...trackMetadata(track, songId) };
      });
    },

    async getRoomOwnerName(userId) {
      const id = positiveId(userId, '用户');
      const getProfile = loadProfile || (loadProfile = find([15], ['/api/w/v1/user/detail/'], exports => {
        return Object.values(exports).find(candidate => typeof candidate === 'function' &&
          Function.prototype.toString.call(candidate).includes('/api/w/v1/user/detail/'));
      }, '房主资料'));
      const data = await withTimeout(() => getProfile(id, {}), 7000, '房主资料加载超时');
      const profile = data?.profile ?? data?.data?.profile;
      if (profile?.userId != null && String(profile.userId) !== id) return '';
      return displayName(profile?.nickname, id);
    },

    async play(songId) {
      const id = positiveId(songId, '歌曲');
      const account = getAccountFrom(state());
      if (!account) throw new Error('请先在网易云原客户端登录');
      const current = getPlayback();
      if (current.songId === id) {
        if (!current.playing && !current.loading) {
          await dispatch('playing/resume', { triggerScene: 'listenTogether' });
        }
        return;
      }
      const tracks = await getTracks()(id);
      if (getAccountFrom(state()) !== account) throw new Error('账号已切换，请刷新房间');
      const track = tracks?.[0];
      if (!track) throw new Error('网易云未返回房间歌曲');
      await dispatch('async:action/doAction', {
        actionId: 'play',
        data: { resource: track, resourceType: 'track', from: { scene: 'listenTogether' } },
      });
    },

    async seek(positionMs) {
      if (!Number.isFinite(positionMs) || positionMs < 0) throw new Error('播放位置无效');
      await dispatch('playing/setPlayingPosition', { duration: positionMs / 1000 });
    },

    async request(name, params) {
      if (!Object.prototype.hasOwnProperty.call(operations, name)) throw new Error('不支持的房间操作');
      const account = getAccountFrom(state());
      if (!account) throw new Error('请先在网易云原客户端登录');
      const definition = operations[name];
      const data = payloadFor(name, params);
      const prepareRequest = requestFactory || (requestFactory = find([12],
        ['cacheStrategy', 'ignoreErrCode', 'encrypt_response'],
        exports => typeof exports?.a === 'function' && exports.a, '原版签名请求'));
      if (definition.needsToken) data.checkToken = await nativeCheckToken();
      if (getAccountFrom(state()) !== account) throw new Error('账号已切换，请重试');

      try {
        const response = await prepareRequest(ROOT + definition.path)(data, {
          cacheStrategy: { enable: false },
          ignoreErrCode: true,
        });
        if (!response || typeof response !== 'object') throw new Error('房间接口响应无效');
        return response;
      } catch (error) {
        const code = Number(error?.code ?? error?.body?.code ?? error?.response?.status);
        if (Number.isFinite(code)) return { code, data: error?.body?.data };
        throw new Error('网易云房间请求失败，请检查网络后重试');
      }
    },
  };
}

module.exports = { createNativeAdapter, payloadFor };
