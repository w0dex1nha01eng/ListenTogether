'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createNativeAdapter } = require('../src/native');

function harness() {
  const state = {
    host: { uid: '42' },
    playing: {
      resourceTrackId: '701',
      resourceName: '正在听的歌',
      playingState: 2,
      isLoadingFirst: false,
    },
  };
  const actions = [];
  const requests = [];
  let requestedTokenCount = 0;
  let position = 19.5;
  let response = () => ({ code: 200, data: {} });
  let issueToken = async () => 'fixture-client-token';

  const store = {
    getStore: () => state,
    getDispatch: () => action => actions.push(action),
  };
  const modules = {
    7: { a: store },
    8: { a: {} },
    12: { a: path => (body, options) => {
      requests.push({ path, body, options });
      return response();
    } },
    110: { b: { getValue: () => position } },
    120: { a: async id => [{ id, name: '房间歌曲' }], b() {} },
    254: {
      a: async () => {},
      b: async () => {
        requestedTokenCount++;
        return issueToken();
      },
    },
  };

  const loader = id => modules[id];
  loader.m = {
    7: function () { /* getStore getDispatch */ },
    8: function () { /* different official module */ },
    12: function () { /* cacheStrategy ignoreErrCode encrypt_response */ },
    110: function () { /* BehaviorSubject playing/setPlayingPosition */ },
    120: function () { /* getStore Promise.all .flat( */ },
    254: function () { /* initWatchman .getToken( */ },
  };
  const chunks = [];
  chunks.push = entry => {
    const probe = entry[0][0];
    entry[1][probe]({}, {}, loader);
  };
  const client = { webpackJsonp: chunks, WM: {} };

  return {
    adapter: createNativeAdapter(client),
    state,
    actions,
    requests,
    get tokenCount() { return requestedTokenCount; },
    setPosition(value) { position = value; },
    setResponse(value) { response = value; },
    setToken(value) { issueToken = value; },
  };
}

test('uses current desktop account and exact seconds/milliseconds conversion', async () => {
  const app = harness();
  assert.equal(app.adapter.getAccount(), '42');
  assert.deepEqual(app.adapter.getPlayback(), {
    songId: '701', title: '正在听的歌', artist: '', positionMs: 19500, playing: true, loading: false,
  });
  await app.adapter.seek(69000);
  assert.deepEqual(app.actions.pop(), {
    type: 'playing/setPlayingPosition', payload: { duration: 69 },
  });
  app.setPosition(0);
  assert.equal(app.adapter.getPlayback().positionMs, 0);
});

test('switches via the original player and resumes the same song', async () => {
  const app = harness();
  await app.adapter.play('702');
  assert.deepEqual(app.actions.pop(), {
    type: 'async:action/doAction',
    payload: {
      actionId: 'play',
      data: { resource: { id: '702', name: '房间歌曲' }, resourceType: 'track', from: { scene: 'listenTogether' } },
    },
  });
  app.state.playing.playingState = 0;
  await app.adapter.play('701');
  assert.deepEqual(app.actions.pop(), {
    type: 'playing/resume', payload: { triggerScene: 'listenTogether' },
  });
});

test('signs only fixed official routes and uses native verification only when needed', async () => {
  const app = harness();
  const roomId = 'b'.repeat(32) + '_1795347300000';
  await app.adapter.request('create', { songId: '701', checkToken: 'untrusted' });
  await app.adapter.request('join', { roomId, inviterUid: '50' });
  await app.adapter.request('status');
  await app.adapter.request('heartbeat', { roomId });
  await app.adapter.request('operate', { roomId, songId: '702' });
  await app.adapter.request('leave', { roomId });
  assert.deepEqual(app.requests.map(value => value.path), [
    'room/create', 'match/ack', 'match/status/get', 'match/heartbeat', 'match/song/operate', 'match/exit',
  ].map(path => '/api/listen/together/multi/' + path));
  assert.deepEqual(app.requests[0].body, {
    songId: '701', type: 1, groupIds: '[]', inviteUids: '[]', from: 'CREATE', playedTime: 0,
    nextSongIds: '[]', checkToken: 'fixture-client-token',
  });
  assert.equal(app.requests[1].body.agree, true);
  assert.equal(app.requests[3].body.checkToken, undefined);
  assert.equal(app.requests[4].body.operate, 1);
  assert.equal(app.requests[5].body.exitType, 'NORMAL_END');
  assert.equal(app.tokenCount, 3);
});

test('does not send a request for guests, invalid inputs, or an unapproved operation', async () => {
  const app = harness();
  await assert.rejects(app.adapter.request('https://invalid.test', {}), /不支持/);
  await assert.rejects(app.adapter.request('create', { songId: '0' }), /歌曲无效/);
  app.state.host.uid = '0';
  await assert.rejects(app.adapter.request('status'), /先在网易云原客户端登录/);
  assert.equal(app.requests.length, 0);
  assert.equal(app.tokenCount, 0);
});

test('does not send a write when native protection checks fail or the account changes', async () => {
  const app = harness();
  app.setToken(async () => '');
  await assert.rejects(app.adapter.request('create', { songId: '701' }), /未提供请求校验/);
  app.setToken(async () => {
    app.state.host.uid = '43';
    return 'fixture-client-token';
  });
  await assert.rejects(app.adapter.request('create', { songId: '701' }), /账号已切换/);
  assert.equal(app.requests.length, 0);
});

test('normalizes the original transport error for expired rooms', async () => {
  const app = harness();
  app.setResponse(() => { throw { response: { status: 488 } }; });
  assert.equal((await app.adapter.request('heartbeat', { roomId: 'mockRoom' })).code, 488);
});

test('fails closed if this renderer has no original module loader', () => {
  const adapter = createNativeAdapter({});
  assert.throws(() => adapter.getAccount(), /主界面尚未就绪/);
});
