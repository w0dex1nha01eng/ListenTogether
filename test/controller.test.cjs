'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createRoomController,
  parseInvite,
  buildInvite,
} = require('../src/controller.js');

const BASE_LINK =
  'https://st.music.163.com/listen-together/multishare/index.html?roomId=room_1&inviterUid=999&isFLT=false';
const ROOM = 'room_1';

function envelope(data) {
  return { code: 200, data };
}

function setImmediateAsync() {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeAdapter(options = {}) {
  const adapter = {
    accountValue: options.account == null ? '12345' : options.account,
    playback: {
      songId: '101',
      positionMs: 0,
      playing: true,
      title: '测试歌曲',
      ...(options.playback || {}),
    },
    calls: [],
    onRequest(name, params) {
      throw new Error(`unexpected request: ${name} ${JSON.stringify(params)}`);
    },
    async getAccount() {
      return adapter.accountValue;
    },
    async getPlayback() {
      return { ...adapter.playback };
    },
    async play(songId) {
      adapter.calls.push({ name: 'play', songId: String(songId) });
      adapter.playback.songId = String(songId);
      adapter.playback.positionMs = 0;
      adapter.playback.playing = true;
    },
    async seek(positionMs) {
      adapter.calls.push({ name: 'seek', positionMs });
      adapter.playback.positionMs = positionMs;
    },
    async request(name, params) {
      adapter.calls.push({ name, params: { ...params } });
      return adapter.onRequest(name, params);
    },
  };
  return adapter;
}

function callsOf(adapter, name) {
  return adapter.calls.filter((call) => call.name === name);
}

function makeController(adapter, options = {}) {
  return createRoomController(adapter, {
    autoPoll: false,
    now: () => 100000,
    progressToleranceMs: 1000,
    playConfirmIntervalMs: 1,
    playConfirmTimeoutMs: 100,
    ...options,
  });
}

function createFakeClock(start = 0) {
  let now = start;
  let sequence = 1;
  const timers = new Map();

  const flush = async () => {
    for (let round = 0; round < 100; round += 1) {
      const due = Array.from(timers.entries())
        .filter(([, timer]) => timer.at <= now)
        .sort((a, b) => a[1].at - b[1].at);
      if (due.length === 0) {
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
        const again = Array.from(timers.values()).some(
          (timer) => timer.at <= now
        );
        if (!again) return;
        continue;
      }
      const [id, timer] = due[0];
      timers.delete(id);
      timer.fn();
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    }
    throw new Error('fake clock flush did not settle');
  };

  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = sequence;
      sequence += 1;
      timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    pending() {
      return timers.size;
    },
    async tick(ms) {
      now += Math.max(0, ms);
      await flush();
    },
  };
}

async function joinRoom(controller, adapter, roomId = ROOM) {
  adapter.onRequest = (name) => {
    if (name === 'join') return envelope({ success: true, roomId });
    throw new Error(`unexpected request: ${name}`);
  };
  return controller.join(
    `https://st.music.163.com/listen-together/multishare/index.html?roomId=${roomId}&inviterUid=999`
  );
}

test('parseInvite/buildInvite 只接受官方多人链接并拒绝 FLT/任意 URL', () => {
  const official = parseInvite(BASE_LINK);
  assert.equal(official.roomId, ROOM);
  assert.equal(official.inviterUid, '999');
  assert.equal(official.isFLT, false);

  const deep = parseInvite(
    'orpheus://nm/multiListenTogether/joinRoom?roomId=room_2&inviterUid=888'
  );
  assert.equal(deep.roomId, 'room_2');
  assert.equal(deep.inviterUid, '888');

  assert.equal(
    parseInvite(
      'https://st.music.163.com/listen-together/multishare/index.html?roomId=room_1&inviterUid=999&isFLT=true'
    ),
    null
  );
  assert.equal(
    parseInvite(
      'https://evil.example/listen-together/multishare/index.html?roomId=room_1&inviterUid=999'
    ),
    null
  );
  assert.equal(
    parseInvite(
      'https://st.music.163.com/listen-together/other/index.html?roomId=room_1&inviterUid=999'
    ),
    null
  );
  assert.equal(parseInvite('javascript:alert(1)'), null);
  assert.equal(parseInvite('room_1:999'), null);

  const link = buildInvite(ROOM, '12345');
  const parsed = new URL(link);
  assert.equal(parsed.hostname, 'st.music.163.com');
  assert.equal(parsed.pathname, '/listen-together/multishare/index.html');
  assert.equal(parsed.searchParams.get('roomId'), ROOM);
  assert.equal(parsed.searchParams.get('inviterUid'), '12345');
  assert.equal(parsed.searchParams.get('isFLT'), 'false');
  assert.equal(buildInvite('bad room', '12345'), '');
  assert.equal(buildInvite({ roomId: ROOM, inviterUid: '12345' }).length > 0, true);
});

test('创建房间：确认业务成功、使用当前账号生成邀请链接、重复点击只发一次 create', async () => {
  const adapter = makeAdapter();
  adapter.onRequest = (name, params) => {
    assert.equal(name, 'create');
    assert.deepEqual(params, { songId: '101' });
    return envelope({
      success: true,
      roomId: ROOM,
      multiLtRoomSnapshot: {
        roomId: ROOM,
        creatorId: '12345',
        multiLtRoomUserAgg: {
          onlineUserInfos: [{ userId: '12345', nickname: '我' }],
        },
      },
    });
  };

  const controller = makeController(adapter);
  const events = [];
  const unsubscribe = controller.subscribe((state) => events.push(state));

  const state = await controller.create();
  assert.equal(state.status, 'joined');
  assert.equal(state.roomId, ROOM);
  assert.equal(state.isOwner, true);
  assert.equal(state.members.length, 1);
  assert.equal(state.members[0].name, '我');
  assert.equal(callsOf(adapter, 'create').length, 1);

  const invite = new URL(state.inviteLink);
  assert.equal(invite.searchParams.get('roomId'), ROOM);
  assert.equal(invite.searchParams.get('inviterUid'), '12345');
  assert.ok(events.length > 0);
  unsubscribe();

  // 慢请求中重复点击复用一个动作，不重复提交。
  const adapter2 = makeAdapter();
  let release;
  adapter2.onRequest = (name) => {
    assert.equal(name, 'create');
    return new Promise((resolve) => {
      release = () =>
        resolve(envelope({ success: true, roomId: 'room_slow' }));
    });
  };
  const controller2 = makeController(adapter2);
  const first = controller2.create();
  const second = controller2.create();
  await setImmediateAsync();
  assert.equal(callsOf(adapter2, 'create').length, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(callsOf(adapter2, 'create').length, 1);
  controller2.dispose();
});

test('访客未登录：提示在原客户端登录且不发请求', async () => {
  const adapter = makeAdapter({ account: '' });
  const controller = makeController(adapter);

  await assert.rejects(controller.create(), /请先在网易云原客户端登录/);
  assert.equal(adapter.calls.length, 0);
  assert.match(controller.getState().error, /登录/);

  const notReadyAdapter = makeAdapter();
  notReadyAdapter.getAccount = async () => {
    throw new Error('网易云主界面尚未就绪');
  };
  const notReadyController = makeController(notReadyAdapter);
  await assert.rejects(notReadyController.create(), /尚未就绪/);
  assert.equal(notReadyAdapter.calls.length, 0);
  assert.match(notReadyController.getState().error, /尚未就绪/);
});

test('加入房间：成功但与邀请链接房间号不一致时拒绝，不污染当前状态', async () => {
  const adapter = makeAdapter();
  adapter.onRequest = () => envelope({ success: true, roomId: 'room_other' });
  const controller = makeController(adapter);

  await assert.rejects(controller.join(BASE_LINK), /不一致/);
  const failed = controller.getState();
  assert.equal(failed.roomId, '');
  assert.equal(failed.status, 'idle');
  assert.match(failed.error, /不一致/);

  const missingAdapter = makeAdapter();
  missingAdapter.onRequest = () => envelope({ success: true });
  const missingController = makeController(missingAdapter);
  await assert.rejects(missingController.join(BASE_LINK), /无法确认已加入房间/);
});

test('加入房间：确认成功且房间号一致，保留邀请人并生成邀请链接', async () => {
  const adapter = makeAdapter();
  const controller = makeController(adapter);
  const state = await joinRoom(controller, adapter);

  assert.equal(state.roomId, ROOM);
  assert.equal(state.inviterUid, '999');
  assert.equal(state.isOwner, false);
  assert.equal(state.status, 'joined');
  assert.deepEqual(callsOf(adapter, 'join')[0].params, {
    roomId: ROOM,
    inviterUid: '999',
  });
  const invite = new URL(state.inviteLink);
  assert.equal(invite.searchParams.get('inviterUid'), '999');
});

test('跟随同曲：心跳位置偏差超过阈值时 seek，关闭跟随后不再自动动本机', async () => {
  const adapter = makeAdapter();
  const controller = makeController(adapter);
  await joinRoom(controller, adapter);

  let roomPosition = 5000;
  adapter.onRequest = (name) => {
    if (name !== 'heartbeat') throw new Error(`unexpected request: ${name}`);
    return envelope({
      roomPlaySongInfo: {
        playSong: { songId: '101' },
        playedTime: roomPosition,
        songDuration: 200000,
        version: 1,
      },
    });
  };

  adapter.playback.positionMs = 1000;
  let state = await controller.setFollowing(true);
  assert.equal(state.roomPlayback.songId, '101');
  assert.deepEqual(callsOf(adapter, 'seek').at(-1), {
    name: 'seek',
    positionMs: 5000,
  });

  state = await controller.setFollowing(false);
  assert.equal(state.following, false);
  roomPosition = 9000;
  assert.equal(callsOf(adapter, 'seek').length, 1);
  controller.dispose();
});

test('跟随换歌：等播放器确认切到同一房间的新歌后再 seek', async () => {
  const adapter = makeAdapter();
  const controller = makeController(adapter);
  await joinRoom(controller, adapter);

  adapter.onRequest = (name) => {
    if (name !== 'heartbeat') throw new Error(`unexpected request: ${name}`);
    return envelope({
      roomPlaySongInfo: {
        playSong: { songId: '202', songBizId: '0' },
        playedTime: 3000,
        songDuration: 180000,
        version: 2,
        nextSongs: [{ songId: '303', name: '下一首' }],
      },
    });
  };

  // 模拟原版换歌装载较慢：play 后过一小段时间 getPlayback 才变成新歌。
  adapter.play = async (songId) => {
    adapter.calls.push({ name: 'play', songId: String(songId) });
    setTimeout(() => {
      adapter.playback.songId = String(songId);
      adapter.playback.positionMs = 0;
      adapter.playback.playing = true;
    }, 8);
  };

  const state = await controller.setFollowing(true);

  const playIndex = adapter.calls.findIndex(
    (call) => call.name === 'play' && call.songId === '202'
  );
  const seekIndex = adapter.calls.findIndex((call) => call.name === 'seek');
  assert.ok(playIndex >= 0, '应调用 play 切换歌曲');
  assert.ok(seekIndex > playIndex, '确认切歌后才应 seek');
  assert.equal(adapter.calls[seekIndex].positionMs, 3000);
  assert.equal(state.roomPlayback.songId, '202');
  assert.deepEqual(state.queue, [{ songId: '303', title: '下一首', artist: '' }]);
  controller.dispose();
});

test('退出：失败保留房间，确认成功后停止轮询并清空房间', async () => {
  const adapter = makeAdapter();
  const controller = makeController(adapter);
  await joinRoom(controller, adapter);

  let leaveShouldFail = true;
  adapter.onRequest = (name) => {
    if (name !== 'leave') throw new Error(`unexpected request: ${name}`);
    if (leaveShouldFail) throw new Error('网络断开');
    return envelope({ success: false });
  };

  await assert.rejects(controller.leave(), /网络断开/);
  let state = controller.getState();
  assert.equal(state.roomId, ROOM);
  assert.equal(state.status, 'joined');
  assert.match(state.error, /网络断开/);

  leaveShouldFail = false;
  // 第一次业务失败仍保留房间。
  await assert.rejects(controller.leave(), /退出房间失败/);
  assert.equal(controller.getState().roomId, ROOM);

  adapter.onRequest = (name) => {
    if (name !== 'leave') throw new Error(`unexpected request: ${name}`);
    return envelope({ success: true });
  };
  state = await controller.leave();
  assert.equal(state.roomId, '');
  assert.equal(state.status, 'idle');
  assert.equal(state.notice, '已退出房间');
  assert.equal(callsOf(adapter, 'leave').length, 3);
  controller.dispose();
});

test('退出后迟到的旧心跳不会改状态，也不会 seek', async () => {
  const adapter = makeAdapter();
  const controller = makeController(adapter);
  await joinRoom(controller, adapter);

  let resolveHeartbeat;
  adapter.onRequest = (name) => {
    if (name === 'heartbeat') {
      return new Promise((resolve) => {
        resolveHeartbeat = resolve;
      });
    }
    if (name === 'leave') return envelope({ success: true });
    throw new Error(`unexpected request: ${name}`);
  };

  const followPromise = controller.setFollowing(true);
  await setImmediateAsync();
  const leaveState = await controller.leave();
  assert.equal(leaveState.roomId, '');

  resolveHeartbeat(
    envelope({
      roomPlaySongInfo: {
        playSong: { songId: '999' },
        playedTime: 60000,
        songDuration: 200000,
        version: 9,
      },
    })
  );
  await followPromise;

  const state = controller.getState();
  assert.equal(state.roomId, '');
  assert.equal(state.status, 'idle');
  assert.equal(callsOf(adapter, 'seek').length, 0);
  assert.equal(callsOf(adapter, 'play').length, 0);
  controller.dispose();
});

test('失败恢复：心跳短暂失败保留房间，下一次成功清除错误；刷新可恢复现有房间', async () => {
  const adapter = makeAdapter();
  const controller = makeController(adapter);
  await joinRoom(controller, adapter);

  let failHeartbeat = true;
  adapter.onRequest = (name) => {
    if (name !== 'heartbeat') throw new Error(`unexpected request: ${name}`);
    if (failHeartbeat) throw new Error('暂时离线');
    return envelope({});
  };

  let state = await controller.setFollowing(true);
  assert.equal(state.roomId, ROOM);
  assert.equal(state.heartbeatFailures, 1);
  assert.match(state.error, /暂时离线/);

  failHeartbeat = false;
  state = await controller.setFollowing(true);
  assert.equal(state.roomId, ROOM);
  assert.equal(state.heartbeatFailures, 0);
  assert.equal(state.error, '');
  assert.equal(state.status, 'joined');
  controller.dispose();

  const refreshAdapter = makeAdapter();
  const refreshController = makeController(refreshAdapter);
  let statusFails = true;
  refreshAdapter.onRequest = (name) => {
    if (name !== 'status') throw new Error(`unexpected request: ${name}`);
    if (statusFails) throw new Error('读取失败');
    return envelope({
      status: 'RECONNECT_SUCCESS',
      multiLtRoomSnapshot: {
        roomId: 'room_refresh',
        creatorId: '999',
        multiLtRoomUserAgg: {
          onlineUserInfos: [
            { userId: '999', nickname: '房主' },
            { userId: '12345', nickname: '我' },
          ],
        },
      },
    });
  };

  state = await refreshController.refresh();
  assert.match(state.error, /读取失败/);
  assert.equal(state.roomId, '');

  statusFails = false;
  state = await refreshController.refresh();
  assert.equal(state.roomId, 'room_refresh');
  assert.equal(state.status, 'joined');
  assert.equal(state.error, '');
  assert.equal(state.members.length, 2);
  refreshController.dispose();
});

test('周期轮询：使用注入时钟按间隔心跳，退出后不再轮询', async () => {
  const clock = createFakeClock(0);
  const adapter = makeAdapter();
  const controller = makeController(adapter, {
    clock,
    autoPoll: true,
    heartbeatIntervalMs: 1000,
    statusIntervalMs: 5000,
  });
  await joinRoom(controller, adapter);
  assert.ok(clock.pending() >= 2);

  adapter.onRequest = (name) => {
    if (name === 'heartbeat') return envelope({});
    if (name === 'status') return envelope({});
    if (name === 'leave') return envelope({ success: true });
    throw new Error(`unexpected request: ${name}`);
  };

  await clock.tick(1000);
  assert.equal(callsOf(adapter, 'heartbeat').length, 1);

  await controller.leave();
  assert.equal(clock.pending(), 0);
  const heartbeatsAfterLeave = callsOf(adapter, 'heartbeat').length;
  await clock.tick(20000);
  assert.equal(callsOf(adapter, 'heartbeat').length, heartbeatsAfterLeave);
  assert.equal(controller.getState().roomId, '');
  controller.dispose();

  const clock2 = createFakeClock(0);
  const adapter2 = makeAdapter();
  const controller2 = makeController(adapter2, {
    clock: clock2,
    autoPoll: true,
    heartbeatIntervalMs: 1000,
    statusIntervalMs: 5000,
  });
  await joinRoom(controller2, adapter2);
  assert.ok(clock2.pending() >= 2);
  controller2.dispose();
  assert.equal(clock2.pending(), 0);
});

test('推送当前歌：确认 failedCode=0，成功写回队列', async () => {
  const adapter = makeAdapter();
  const controller = makeController(adapter);
  await joinRoom(controller, adapter);

  adapter.onRequest = (name, params) => {
    if (name !== 'operate') throw new Error(`unexpected request: ${name}`);
    assert.deepEqual(params, { roomId: ROOM, songId: '404' });
    return envelope({ failedCode: 0 });
  };

  adapter.playback = {
    songId: '404',
    positionMs: 12000,
    playing: true,
    title: '要推的歌',
  };
  const state = await controller.pushCurrent();
  assert.equal(state.notice, '已推送当前歌曲');
  assert.deepEqual(state.queue, [{ songId: '404', title: '要推的歌', artist: '' }]);

  adapter.onRequest = () => envelope({ failedCode: 7, failedMessage: '不可播放' });
  await assert.rejects(controller.pushCurrent(), /不可播放/);
  assert.equal(controller.getState().roomId, ROOM);

  adapter.onRequest = () => ({ code: 488, data: {} });
  await assert.rejects(controller.pushCurrent(), /房间已结束/);
  assert.equal(controller.getState().roomId, '');
  assert.equal(controller.getState().status, 'idle');
  controller.dispose();
});

test('从歌曲菜单推荐选中的歌曲，原播放器继续播放', async () => {
  const adapter = makeAdapter();
  const controller = makeController(adapter);
  await joinRoom(controller, adapter);
  adapter.getPlayback = () => assert.fail('菜单推荐不需要读取当前播放歌曲');
  adapter.onRequest = (name, params) => {
    assert.equal(name, 'operate');
    assert.deepEqual(params, { roomId: ROOM, songId: '404' });
    return envelope({ failedCode: 0 });
  };

  const state = await controller.recommend({ songId: '404', title: '选中的歌', artist: '演唱者' });
  assert.equal(state.notice, '已推荐');
  assert.deepEqual(state.queue, [{ songId: '404', title: '选中的歌', artist: '演唱者' }]);
  assert.equal(adapter.playback.songId, '101');
  assert.deepEqual(callsOf(adapter, 'play'), []);
  assert.deepEqual(callsOf(adapter, 'seek'), []);

  adapter.accountValue = '900';
  await assert.rejects(controller.recommend({ songId: '405' }), /账号已切换/);
  assert.equal(callsOf(adapter, 'operate').length, 1);
  controller.dispose();
});

test('房主与转发者分开识别，队列里只有歌曲编号时补齐歌名和歌手', async () => {
  const adapter = makeAdapter();
  const controller = makeController(adapter);
  const trackCalls = [];
  adapter.getTrackMetadata = async ids => {
    trackCalls.push(ids);
    return [
      { songId: '101', title: '房间当前曲', artist: '甲' },
      { songId: '40012345', title: '下一首真名', artists: [{ name: '乙' }, { name: '丙' }] },
    ];
  };
  const play = {
    playSong: { songId: '101', name: '101' },
    nextSongs: [{ songId: '40012345', name: '40012345' }],
  };
  adapter.onRequest = name => name === 'join' ? envelope({ success: true, multiLtRoomSnapshot: {
    multiRoomInfoDTO: { roomId: ROOM, creatorId: '420' },
    multiLtRoomUserAgg: { onlineUserInfos: [{ userId: '420', nickname: '房主橘子' }, { userId: '999', nickname: '转发者' }] },
    roomPlaySongInfo: play,
  } }) : envelope({ roomPlaySongInfo: play });
  await controller.join(BASE_LINK);
  await setImmediateAsync();
  assert.equal(controller.getState().roomOwnerName, '房主橘子');
  assert.equal(controller.getState().roomPlayback.artist, '甲');
  assert.deepEqual(controller.getState().queue, [{ songId: '40012345', title: '下一首真名', artist: '乙、丙' }]);
  await controller.refresh();
  assert.deepEqual(trackCalls, [['101', '40012345']]);
  assert.equal(controller.getState().queue[0].title, '下一首真名');
  controller.dispose();
});

test('离开房间后丢弃仍在请求的房主和曲目信息', async () => {
  const adapter = makeAdapter();
  const controller = makeController(adapter);
  let finishOwner;
  let finishTracks;
  adapter.getRoomOwnerName = () => new Promise(resolve => { finishOwner = resolve; });
  adapter.getTrackMetadata = () => new Promise(resolve => { finishTracks = resolve; });
  adapter.onRequest = name => name === 'join' ? envelope({ success: true, roomId: ROOM, creatorId: '420',
    roomPlaySongInfo: { nextSongs: ['40012345'] } }) : envelope({ success: true });
  await controller.join(BASE_LINK);
  await setImmediateAsync();
  await controller.leave();
  finishOwner('已离开房间的房主');
  finishTracks([{ songId: '40012345', title: '已离开房间的歌曲' }]);
  await setImmediateAsync();
  assert.equal(controller.getState().roomOwnerName, '');
  assert.deepEqual(controller.getState().queue, []);
  controller.dispose();
});
