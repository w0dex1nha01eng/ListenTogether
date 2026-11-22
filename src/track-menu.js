'use strict';

const { trackMetadata } = require('./metadata');

const songIdPattern = /^[1-9]\d{0,23}$/;

function mountTrackMenu(template, bridge, onRecommend) {
  const items = template.content;
  const issued = new Map();
  const prefix = 'ncmLt' + Math.random().toString(36).slice(2, 8);
  let sequence = 0;
  const item = {
    text: '推荐此歌曲',
    image_path: 'addall.svg',
    check({ payload, contentItem }) {
      const { resource, resourceType, enableReturnMenu } = payload;
      if (enableReturnMenu || !['track', 'downloadedTrack'].includes(resourceType)) return null;
      const songId = String(resource?.id ?? '');
      if (!songIdPattern.test(songId)) return null;

      const actionId = prefix + (++sequence).toString(36);
      if (issued.size >= 8) issued.delete(issued.keys().next().value);
      issued.set(actionId, { songId, ...trackMetadata(resource, songId) });
      return { ...contentItem, action_id: actionId };
    },
  };

  const onClick = menuId => {
    const track = issued.get(menuId);
    issued.clear();
    if (track) onRecommend(track);
  };
  const index = items.findIndex(option => option.action_id === 'nextPlay');
  bridge.appendRegisterCall('menuclick', 'winhelper', onClick);
  try {
    items.splice(index + 1, 0, item);
  } catch (error) {
    bridge.removeRegisterCall('menuclick', 'winhelper', onClick);
    throw error;
  }

  return () => {
    issued.clear();
    const index = items.indexOf(item);
    if (index !== -1) items.splice(index, 1);
    bridge.removeRegisterCall('menuclick', 'winhelper', onClick);
  };
}

module.exports = { mountTrackMenu };
