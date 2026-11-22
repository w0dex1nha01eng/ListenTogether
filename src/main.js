'use strict';

const { createNativeAdapter } = require('./native');
const { createRoomController } = require('./controller');
const { mountRoomPanel } = require('./panel');

const lifecycle = Symbol.for('ncm-listen-together.plugin');

plugin.onLoad(() => {
  window[lifecycle]?.dispose();
  const adapter = createNativeAdapter(window);
  const controller = createRoomController(adapter);
  const panel = mountRoomPanel(controller, { document, window });
  let removeMenu;
  let retryTimer;
  let attempts = 0;
  const recommend = async track => {
    if (!controller.getState().inRoom) {
      await controller.refresh();
      if (window[lifecycle]?.dispose !== dispose) return;
      if (!controller.getState().inRoom) {
        panel.open();
        panel.notify('请先创建或加入房间', true);
        return;
      }
    }
    try {
      await controller.recommend(track);
      panel.notify('已推荐');
    } catch (error) {
      panel.notify(error.message || '推荐歌曲失败', true);
    }
  };
  function installMenu() {
    try {
      removeMenu = adapter.installTrackMenu(recommend);
    } catch (error) {
      attempts += 1;
      if (attempts < 20) retryTimer = window.setTimeout(installMenu, 500);
      else console.warn('[一起听] ' + error.message);
    }
  }

  const dispose = () => {
    window.removeEventListener('pagehide', dispose);
    window.clearTimeout(retryTimer);
    removeMenu?.();
    panel.dispose();
    controller.dispose();
    if (window[lifecycle]?.dispose === dispose) delete window[lifecycle];
  };
  window[lifecycle] = { open: () => panel.open(), dispose };
  window.addEventListener('pagehide', dispose, { once: true });
  installMenu();
});

if (typeof plugin.onConfig === 'function') {
  plugin.onConfig(() => {
    const button = document.createElement('button');
    button.textContent = '打开多人一起听';
    button.addEventListener('click', () => window[lifecycle]?.open());
    return button;
  });
}
