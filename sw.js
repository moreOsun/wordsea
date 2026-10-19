/* ================= Service Worker - 离线缓存（词海 WordSea） =================
 * 数据文件 data-*.js 一并预缓存：安装完成后完全离线可用
 * 发布新版：递增 CACHE + 同步 index.html 里的 ?v= 串（保证升级后第一次刷新即拿到新代码） */
var CACHE = 'sc-wordsea-v5';
var V = '?v=5';
var ASSETS = [
  './',
  './index.html',
  './styles.css' + V,
  './app.js' + V,
  './data-cet4.js' + V,
  './data-cet6.js' + V,
  './data-kaoyan.js' + V,
  './data-sentence.js' + V,
  './data-extra.js' + V,
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png',
  './sponsor-wechat.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); })
  );
  // 不再自动 skipWaiting：新 worker 进入 waiting，由页面提示用户后再激活
});

// 页面点击“立即更新”时发消息，才跳过等待并接管
self.addEventListener('message', function (e) {
  if (e.data && e.data.action === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// 取用策略：导航/HTML 网络优先（断网回退缓存，改版即时生效）；
// 其余静态资源（含词库数据）缓存优先，离线秒开。
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var isNav = req.mode === 'navigate' || /\.html?$/i.test(new URL(req.url).pathname);

  if (isNav) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () { return caches.match(req).then(function (h) { return h || caches.match('./index.html'); }); })
    );
    return;
  }

  // 静态资源：stale-while-revalidate —— 先秒回缓存，后台拉取并更新（下次即最新）
  e.respondWith(
    caches.match(req).then(function (hit) {
      var refresh = fetch(req).then(function (res) {
        if (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return null; });
      return hit || refresh.then(function (r) { return r || Response.error(); });
    })
  );
});
