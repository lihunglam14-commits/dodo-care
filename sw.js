/* DoDo 離線支援（最簡版）。
 * - 網頁（HTML）：先上網拿最新版本；上不到網（或 4 秒無回應）才用上次儲存的版本 → 有網絡時資料永遠最新。
 * - /assets/ 內的檔案名稱含雜湊（內容改變＝名稱改變），可以放心長期儲存。
 * - 只處理本網站的檔案；政府網站、WhatsApp、地圖一律不經 service worker。
 * 緊急停用：把整個檔案換成 scripts/sw-kill.js 的內容再發布。
 */
// 發布時由 scripts/stamp_sw.mjs 換成這次版本的編號，令瀏覽器安裝新版並清除舊檔案
const CACHE = 'dodo-db8814fef3';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const files = new Set(['./', './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png', './icons/favicon-64.png']);
      try {
        const res = await fetch('./asset-manifest.json', { cache: 'no-store' });
        const manifest = await res.json();
        for (const chunk of Object.values(manifest)) {
          files.add('./' + chunk.file);
          (chunk.css ?? []).forEach((f) => files.add('./' + f));
          (chunk.assets ?? []).forEach((f) => files.add('./' + f));
        }
      } catch {
        /* 沒有清單時只儲存首頁；其他檔案會在第一次使用時儲存 */
      }
      await cache.addAll([...files]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // API 及管理頁必須直接向伺服器查詢，不可在離線時顯示舊首頁。
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await Promise.race([
            fetch(req, { cache: 'no-cache' }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
          ]);
          // 只把網站首頁存作離線版本（例如打開 /api/ai 不會覆蓋首頁）
          const scopePath = new URL('./', self.registration.scope).pathname;
          if (res.ok && (url.pathname === scopePath || url.pathname === `${scopePath}index.html`)) await cache.put('./', res.clone());
          return res;
        } catch {
          return (await cache.match('./')) ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (url.pathname.includes('/assets/') || url.pathname.includes('/icons/') || url.pathname.endsWith('manifest.webmanifest')) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })(),
    );
  }
});
