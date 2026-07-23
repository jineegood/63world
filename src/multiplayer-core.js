(function initYuksamMultiplayerCore(global) {
  'use strict';

  function realtimeWebSocketUrl(rawUrl, anonKey) {
    try {
      const url = new URL(String(rawUrl || ''));
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.pathname = '/realtime/v1/websocket';
      url.search = '';
      url.hash = '';
      url.searchParams.set('apikey', String(anonKey || ''));
      url.searchParams.set('vsn', '1.0.0');
      return url.toString();
    } catch {
      return '';
    }
  }

  global.YuksamMultiplayerCore = Object.freeze({ realtimeWebSocketUrl });
})(window);
