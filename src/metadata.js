'use strict';

function displayName(value, id = '') {
  if (typeof value !== 'string') return '';
  const name = value.trim();
  if (name === id || /^(?:\d{7,}|[a-f0-9]{24,}(?:_\d+)?|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(name) ||
      /^(?:https?|orpheus):\/\//i.test(name)) return '';
  return name;
}

function trackMetadata(track, songId) {
  const sources = [track?.ar, track?.artists, track?.artist, track?.artistName, track?.singerName];
  let artist = '';
  for (const source of sources) {
    const list = Array.isArray(source) ? source : [source];
    const names = list.map(entry => displayName(entry?.name ?? entry, String(entry?.id ?? ''))).filter(Boolean);
    if (names.length) {
      artist = [...new Set(names)].join('、');
      break;
    }
  }
  const title = [track?.name, track?.songName, track?.title].map(name => displayName(name, songId)).find(Boolean) || '';
  return { title, artist };
}

module.exports = { displayName, trackMetadata };
