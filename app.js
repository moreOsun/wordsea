/* ================= 词海 WordSea · 应用逻辑 =================
 * 纯前端离线：数据来自 data-cet4/cet6/kaoyan/sentence/extra.js
 * 约定：CSS 类名 sc- 前缀；进度存 localStorage（键见下方 *_KEY）
 * 兼容：ES5 写法 + 字符串拼接，避免老内核（MIUI 等）不支持的语法
 */
var SC_VERSION = 'v1.0.0-multi';

(function () {
  'use strict';

  /* ---------- 数据汇总 ---------- */
  var CET4 = window.WORDSEA_CET4 || [];
  var CET6 = window.WORDSEA_CET6 || [];
  var KAOYAN = window.WORDSEA_KAOYAN || [];
  var SENTENCES = window.WORDSEA_SENTENCES || [];
  var EXTRA = window.WORDSEA_EXTRA || [];

  var CAT_NAME = { cet4: '四级词汇', cet6: '六级词汇', kaoyan: '考研词汇', extra: '扩充词库' };
  var CAT_SRC = { cet4: CET4, cet6: CET6, kaoyan: KAOYAN, extra: EXTRA };
  var CAT_PREFIX = { cet4: 'C4', cet6: 'C6', kaoyan: 'KY', extra: 'EX' };

  var ALL = [];
  var BY_ID = {};
  var BY_CAT = { cet4: [], cet6: [], kaoyan: [], extra: [] };

  function pad(n, len) { var s = '' + n; while (s.length < len) s = '0' + s; return s; }

  function ingest(cat) {
    var src = CAT_SRC[cat] || [];
    for (var k = 0; k < src.length; k++) {
      var w = src[k];
      w.kind = w.kind || cat;
      w.id = (CAT_PREFIX[w.kind] || 'XX') + '-' + pad(k + 1, 4);
      if (!w.w) continue;
      ALL.push(w); BY_ID[w.id] = w;
      if (BY_CAT[w.kind]) BY_CAT[w.kind].push(w);
    }
  }
  ingest('cet4'); ingest('cet6'); ingest('kaoyan'); ingest('extra');

  /* ---------- localStorage ---------- */
  var STAR_KEY = 'sc_ws_star_v1';       // 生词本：id 数组
  var STATUS_KEY = 'sc_ws_status_v1';   // 熟练度：{ id: 'new|learning|master' }
  var CHECK_KEY = 'sc_ws_checkin_v1';   // 打卡：{ last:'YYYY-MM-DD', streak:n, days:{date:1} }
  var SENTFAV_KEY = 'sc_ws_sentfav_v1'; // 每日一句收藏：en 文本数组
  var SRS_KEY = 'sc_ws_srs_v1';         // 艾宾浩斯复习：{ id:{step:n, due:'YYYY-MM-DD'} }
  var STATS_KEY = 'sc_ws_stats_v1';     // 学习曲线：{ 'YYYY-MM-DD':{t:o,m:o} }（t=答题数, o=对数, m=新增掌握）

  function lsGet(key, dft) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? dft : v; }
    catch (e) { return dft; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function loadStar() { return lsGet(STAR_KEY, []); }
  function isStar(id) { return loadStar().indexOf(id) !== -1; }
  function toggleStar(id) {
    var list = loadStar(), pos = list.indexOf(id);
    if (pos === -1) list.push(id); else list.splice(pos, 1);
    lsSet(STAR_KEY, list);
    refreshCounts();
    return pos === -1;
  }

  function loadStatus() { return lsGet(STATUS_KEY, {}); }
  function getStatus(id) { return loadStatus()[id] || ''; }
  function setStatus(id, level) {
    var m = loadStatus();
    if (!level || level === 'new') delete m[id]; else m[id] = level;
    lsSet(STATUS_KEY, m);
    refreshCounts();
  }

  function loadSentFav() { return lsGet(SENTFAV_KEY, []); }
  function isSentFav(en) { return loadSentFav().indexOf(en) !== -1; }
  function toggleSentFav(en) {
    var list = loadSentFav(), pos = list.indexOf(en);
    if (pos === -1) list.push(en); else list.splice(pos, 1);
    lsSet(SENTFAV_KEY, list);
    refreshCounts();
    return pos === -1;
  }

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
  }
  function dayDiff(a, b) { // 返回 b - a 的自然日差
    return Math.round((new Date(b.replace(/-/g, '/')) - new Date(a.replace(/-/g, '/'))) / 86400000);
  }
  function doCheckin() {
    var st = lsGet(CHECK_KEY, { last: '', streak: 0, days: {} });
    var tk = todayKey();
    if (st.days[tk]) { toast('今天已经打过卡啦'); return false; }
    var diff = st.last ? dayDiff(st.last, tk) : 999;
    st.streak = (diff === 1) ? st.streak + 1 : 1;
    st.last = tk; st.days[tk] = 1;
    lsSet(CHECK_KEY, st);
    renderCheckin();
    toast('打卡成功，已连续 ' + st.streak + ' 天');
    return true;
  }
  function renderCheckin() {
    var st = lsGet(CHECK_KEY, { last: '', streak: 0, days: {} });
    var doneToday = !!st.days[todayKey()];
    $('sc-streak').textContent = st.streak;
    $('sc-checkin-tip').textContent = '累计打卡 ' + Object.keys(st.days).length + ' 天';
    var btn = $('sc-checkin-btn');
    if (doneToday) { btn.textContent = '今日已打卡 ✓'; btn.classList.add('sc-done'); }
    else { btn.textContent = '今日打卡'; btn.classList.remove('sc-done'); }
  }

  /* ---------- 艾宾浩斯遗忘曲线复习调度 ---------- */
  var SRS_INTERVALS = [0, 1, 2, 4, 7, 15, 30];   // 复习间隔（天）
  function keyOfDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2); }
  function srsAll() { return lsGet(SRS_KEY, {}); }
  function srsUpdate(id, ok) {
    var m = srsAll(), e = m[id] || { step: 0 };
    e.step = ok ? Math.min(e.step + 1, SRS_INTERVALS.length - 1) : 0;
    var d = new Date(); d.setDate(d.getDate() + SRS_INTERVALS[e.step]);
    e.due = keyOfDate(d);
    m[id] = e; lsSet(SRS_KEY, m);
  }
  function dueList() {
    var m = srsAll(), tk = todayKey(), out = [];
    for (var id in m) if (m.hasOwnProperty(id)) {
      if (m[id].due && m[id].due <= tk && BY_ID[id]) out.push(BY_ID[id]);
    }
    return out;
  }

  /* ---------- 学习曲线统计 ---------- */
  function logStat(ok, becameMaster) {
    var st = lsGet(STATS_KEY, {}), tk = todayKey();
    var d = st[tk] || { t: 0, o: 0, m: 0 };
    d.t = (d.t || 0) + 1;
    if (ok) d.o = (d.o || 0) + 1;
    if (becameMaster) d.m = (d.m || 0) + 1;
    st[tk] = d; lsSet(STATS_KEY, st);
  }
  function statsTotals() {
    var st = lsGet(STATS_KEY, {}), t = 0, o = 0, m = 0;
    for (var k in st) if (st.hasOwnProperty(k)) { t += st[k].t || 0; o += st[k].o || 0; m += st[k].m || 0; }
    return { t: t, o: o, m: m };
  }
  function lastNDays(n) {
    var arr = [], d = new Date();
    for (var i = n - 1; i >= 0; i--) {
      var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
      arr.push(x.getFullYear() + '-' + pad(x.getMonth() + 1, 2) + '-' + pad(x.getDate(), 2));
    }
    return arr;
  }
  var statsRange = 14;
  function renderStats() {
    var st = lsGet(STATS_KEY, {}), tot = statsTotals();
    var acc = tot.t ? Math.round(tot.o / tot.t * 100) : 0;
    var stt = loadStatus(), master = 0;
    for (var id in stt) if (stt.hasOwnProperty(id) && stt[id] === 'master') master++;
    var ck = lsGet(CHECK_KEY, { streak: 0, days: {} });
    $('sc-kpi-touch').textContent = tot.t;
    $('sc-kpi-acc').textContent = acc + '%';
    $('sc-kpi-master').textContent = master;
    $('sc-kpi-streak').textContent = ck.streak || 0;

    // 每日学习量柱状图
    var days = lastNDays(statsRange), maxT = 1, i;
    for (i = 0; i < days.length; i++) { var v = (st[days[i]] && st[days[i]].t) || 0; if (v > maxT) maxT = v; }
    var barBox = $('sc-chart-daily'), axBox = $('sc-chart-axis');
    barBox.innerHTML = ''; axBox.innerHTML = '';
    var tkn = todayKey(), recent = 0;
    for (i = 0; i < days.length; i++) {
      var k = days[i], tv = (st[k] && st[k].t) || 0; recent += tv;
      var bar = document.createElement('div');
      bar.className = 'sc-bar' + (k === tkn ? ' sc-today' : '');
      bar.style.height = (tv ? Math.max(8, Math.round(tv / maxT * 100)) : 2) + '%';
      if (tv && statsRange <= 14) { var sp = document.createElement('span'); sp.textContent = tv; bar.appendChild(sp); }
      barBox.appendChild(bar);
      var pp = k.split('-');
      var lab = document.createElement('i');
      lab.textContent = (statsRange <= 14) ? (pp[1] + '/' + pp[2]) : (i % 5 === 0 ? pp[1] + '/' + pp[2] : '');
      axBox.appendChild(lab);
    }

    // 累计掌握增长曲线（SVG，按有记录日的时间顺序累加当日新增掌握）
    var keys = []; for (var kk in st) if (st.hasOwnProperty(kk)) keys.push(kk);
    keys.sort();
    var cum = 0, pts = [];
    for (i = 0; i < keys.length; i++) { cum += (st[keys[i]].m || 0); pts.push(cum); }
    var W = 300, H = 120, n = pts.length, maxC = Math.max(1, cum);
    var svg = $('sc-chart-cum');
    if (n >= 2) {
      var xs = [], ys = [], li;
      for (li = 0; li < n; li++) { xs.push((li / (n - 1)) * W); ys.push(H - (pts[li] / maxC) * (H - 12) - 6); }
      var linePts = '', area = 'M' + xs[0].toFixed(1) + ',' + H + ' ';
      for (li = 0; li < n; li++) { linePts += xs[li].toFixed(1) + ',' + ys[li].toFixed(1) + ' '; area += 'L' + xs[li].toFixed(1) + ',' + ys[li].toFixed(1) + ' '; }
      area += 'L' + xs[n - 1].toFixed(1) + ',' + H + ' Z';
      svg.innerHTML = '<path class="sc-area" d="' + area + '"/><polyline class="sc-curve" points="' + linePts + '"/>' +
        '<circle class="sc-dot" cx="' + xs[n - 1].toFixed(1) + '" cy="' + ys[n - 1].toFixed(1) + '" r="3"/>';
    } else {
      svg.innerHTML = '';
    }
    var note = $('sc-stats-note');
    note.textContent = tot.t === 0
      ? '还没有学习记录，去“训练”里答几题，曲线会自动生成。'
      : ('共记录 ' + keys.length + ' 天，最近 ' + statsRange + ' 天学习 ' + recent + ' 词，累计新增掌握 ' + tot.m + ' 词。');
  }

  /* ---------- 工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('sc-toast');
    t.textContent = msg;
    t.classList.remove('sc-hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('sc-hidden'); }, 1800);
  }

  // 发音：Web Speech API（离线是否可朗读者依系统语音包，失败静默提示）
  function speak(text) {
    try {
      if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
        toast('本设备不支持语音发音'); return;
      }
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US'; u.rate = 0.9; u.pitch = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { toast('发音失败'); }
  }

  /* ---------- 视图切换 ---------- */
  var views = ['sc-view-home', 'sc-view-list', 'sc-view-word', 'sc-view-train', 'sc-view-quiz', 'sc-view-stats', 'sc-view-sentfav'];
  var curListTab = '';   // 底部导航高亮用
  function showView(id) {
    for (var v = 0; v < views.length; v++) {
      $(views[v]).classList.toggle('sc-active', views[v] === id);
    }
    var tabs = document.querySelectorAll('.sc-tabbar button');
    for (var t = 0; t < tabs.length; t++) {
      var btn = tabs[t];
      var on = (btn.getAttribute('data-view') === id) ||
        (id === 'sc-view-list' && btn.getAttribute('data-view-list') === curListTab);
      btn.classList.toggle('sc-on', !!on);
    }
    window.scrollTo(0, 0);
  }

  /* ---------- 列表上下文 ---------- */
  var BATCH = 30;
  var listCtx = null;   // {type, title, items, shown}
  var wordCtx = null;   // {items, index}

  function openList(type, title, items) {
    listCtx = { type: type, title: title, items: items, shown: 0 };
    curListTab = (type === 'cet4' || type === 'cet6' || type === 'kaoyan' || type === 'star') ? type : '';
    $('sc-list-title').textContent = title;
    $('sc-list-count').textContent = items.length + ' 词';
    $('sc-word-list').innerHTML = '';
    $('sc-list-empty').classList.toggle('sc-hidden', items.length > 0);
    loadBatch();
    showView('sc-view-list');
  }

  function setListByType(type) {
    if (type === 'cet4') openList('cet4', CAT_NAME.cet4, BY_CAT.cet4.slice());
    else if (type === 'cet6') openList('cet6', CAT_NAME.cet6, BY_CAT.cet6.slice());
    else if (type === 'kaoyan') openList('kaoyan', CAT_NAME.kaoyan, BY_CAT.kaoyan.slice());
    else if (type === 'master') {
      var mm = [];
      for (var k = 0; k < ALL.length; k++) if (getStatus(ALL[k].id) === 'master') mm.push(ALL[k]);
      openList('master', '已掌握（' + mm.length + '）', mm);
    }
    else if (type === 'star') {
      var ids = loadStar(), items = [];
      for (var i = 0; i < ids.length; i++) if (BY_ID[ids[i]]) items.push(BY_ID[ids[i]]);
      openList('star', '生词本', items);
    }
  }

  function dotClass(w) {
    var lv = getStatus(w.id);
    if (lv === 'master') return 'sc-lv-master';
    if (lv === 'learning') return 'sc-lv-learning';
    if (isStar(w.id)) return 'sc-lv-star';
    return '';
  }

  // 详情里改了熟练度/生词本后，回到列表时同步刷新该行状态圆点（列表已渲染的条目）
  function refreshListDot(id) {
    if (!listCtx || !BY_ID[id]) return;
    var li = document.querySelector('#sc-word-list li[data-id="' + id + '"]');
    if (!li) return;
    var dot = li.querySelector('.sc-wi-dot');
    if (dot) dot.className = 'sc-wi-dot ' + dotClass(BY_ID[id]);
  }

  function loadBatch() {
    var ul = $('sc-word-list'), items = listCtx.items, start = listCtx.shown;
    var end = Math.min(start + BATCH, items.length);
    var html = '';
    for (var k = start; k < end; k++) {
      var w = items[k];
      html += '<li class="sc-word-item" data-id="' + w.id + '">' +
        '<div class="sc-wi-main">' +
        '<span class="sc-wi-w">' + esc(w.w) + '</span>' +
        (w.p ? '<span class="sc-wi-p">/' + esc(w.p) + '/</span>' : '') +
        '<div class="sc-wi-t">' + esc(w.t) + '</div>' +
        '</div>' +
        '<span class="sc-wi-dot ' + dotClass(w) + '"></span>' +
        '</li>';
    }
    ul.insertAdjacentHTML('beforeend', html);
    listCtx.shown = end;
    $('sc-load-more').classList.toggle('sc-hidden', end >= items.length);
  }

  /* ---------- 搜索 ---------- */
  function doSearch(q) {
    q = (q || '').trim().toLowerCase();
    if (!q) { toast('请输入搜索关键词'); return; }
    var items = [];
    for (var k = 0; k < ALL.length; k++) {
      var w = ALL[k];
      if (w.w.toLowerCase().indexOf(q) !== -1 || (w.t && w.t.indexOf(q) !== -1)) {
        items.push(w);
        if (items.length >= 300) break;   // 结果上限，防极端查询过慢
      }
    }
    openList('search', '搜索：' + q + '（' + items.length + '）', items);
  }

  /* ---------- 单词详情 ---------- */
  function openWord(items, index) {
    wordCtx = { items: items, index: index };
    renderWord();
    showView('sc-view-word');
  }
  function openWordById(id, items) {
    var w = BY_ID[id];
    if (!w) return;
    var list = items || ALL, idx = -1;
    for (var k = 0; k < list.length; k++) if (list[k].id === id) { idx = k; break; }
    if (idx === -1) { list = [w]; idx = 0; }
    openWord(list, idx);
  }
  function renderWord() {
    var w = wordCtx.items[wordCtx.index];
    $('sc-word-crumb').textContent = CAT_NAME[w.kind] || '单词';
    $('sc-word-w').textContent = w.w;
    $('sc-word-p').textContent = w.p ? '/' + w.p + '/' : '';
    $('sc-word-t').textContent = w.t || '';
    var ex = $('sc-word-example');
    if (w.e) {
      $('sc-ex-en').textContent = w.e;
      $('sc-ex-cn').textContent = w.ec || '';
      ex.classList.remove('sc-hidden');
    } else {
      ex.classList.add('sc-hidden');
    }
    var starred = isStar(w.id);
    $('sc-word-star').textContent = starred ? '★' : '☆';
    $('sc-word-star').classList.toggle('sc-faved', starred);
    // 熟练度高亮
    var lv = getStatus(w.id) || 'new';
    var chips = $('sc-mastery-row').children;
    for (var c = 0; c < chips.length; c++) {
      chips[c].classList.toggle('sc-on', chips[c].getAttribute('data-level') === lv);
    }
    $('sc-word-idx').textContent = (wordCtx.index + 1) + ' / ' + wordCtx.items.length;
    $('sc-word-prev').style.visibility = wordCtx.index > 0 ? 'visible' : 'hidden';
    $('sc-word-next').style.visibility = wordCtx.index < wordCtx.items.length - 1 ? 'visible' : 'hidden';
  }
  function wordBack() {
    if (listCtx) showView('sc-view-list'); else showView('sc-view-home');
  }

  /* ---------- 每日一句（按日期固定，可换） ---------- */
  var sentIdx = 0;
  function daySentenceIdx() {
    if (!SENTENCES.length) return 0;
    var d = new Date();
    // 用「连续日序」取模：相邻两天索引必相邻，只要总数 >= 366，任意连续 365 天必不重复
    var dayNum = Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000);
    return ((dayNum % SENTENCES.length) + SENTENCES.length) % SENTENCES.length;
  }
  function showSentence(advance) {
    if (!SENTENCES.length) return;
    if (advance) sentIdx = (sentIdx + 1) % SENTENCES.length;
    var s = SENTENCES[sentIdx];
    $('sc-daily-en').textContent = s.en;
    $('sc-daily-cn').textContent = s.cn || '';
    $('sc-daily-src').textContent = s.src ? '— ' + s.src : '';
    var fav = $('sc-daily-fav');
    var faved = isSentFav(s.en);
    fav.textContent = faved ? '★ 已收藏' : '☆ 收藏句子';
    fav.classList.toggle('sc-faved', faved);
  }

  /* ---------- 我藏的句子 ---------- */
  function renderSentFav() {
    var favs = loadSentFav(), map = {};
    for (var k = 0; k < SENTENCES.length; k++) map[SENTENCES[k].en] = SENTENCES[k];
    var html = '', cnt = 0;
    for (var i = 0; i < favs.length; i++) {
      var s = map[favs[i]];
      if (!s) continue;
      cnt++;
      html += '<div class="sc-sent-item" data-en="' + esc(s.en) + '">' +
        '<div class="sc-sent-en">' + esc(s.en) + '</div>' +
        (s.cn ? '<div class="sc-sent-cn">' + esc(s.cn) + '</div>' : '') +
        (s.src ? '<div class="sc-sent-src">— ' + esc(s.src) + '</div>' : '') +
        '<div class="sc-sent-tools">' +
        '<button type="button" class="sc-btn-mini" data-act="say">🔊 朗读</button>' +
        '<button type="button" class="sc-btn-mini sc-faved" data-act="unfav">★ 取消收藏</button>' +
        '</div></div>';
    }
    $('sc-sentfav-wrap').innerHTML = html;
    $('sc-sentfav-count').textContent = cnt + ' 句';
    $('sc-sentfav-empty').classList.toggle('sc-hidden', cnt > 0);
  }

  /* ---------- 首页统计 ---------- */
  function refreshCounts() {
    var st = loadStatus(), star = loadStar(), master = 0, learning = 0;
    for (var id in st) if (st.hasOwnProperty(id)) {
      if (st[id] === 'master') master++; else if (st[id] === 'learning') learning++;
    }
    $('sc-cat-cet4-n').textContent = BY_CAT.cet4.length + ' 词';
    $('sc-cat-cet6-n').textContent = BY_CAT.cet6.length + ' 词';
    $('sc-cat-kaoyan-n').textContent = BY_CAT.kaoyan.length + ' 词';
    $('sc-cat-star-n').textContent = star.length + ' 词';
    $('sc-cat-master-n').textContent = master + ' 词';
    $('sc-cat-sent-n').textContent = loadSentFav().length + ' 句';
    $('sc-stats-line').textContent = '收录四级 ' + BY_CAT.cet4.length + ' 词、六级 ' + BY_CAT.cet6.length +
      ' 词、考研 ' + BY_CAT.kaoyan.length + ' 词，共 ' + ALL.length + ' 词；在学 ' + learning +
      ' 词、已掌握 ' + master + ' 词、生词本 ' + star.length + ' 词。';
    // 首页学习曲线摘要
    var tot = statsTotals();
    var tacc = tot.t ? Math.round(tot.o / tot.t * 100) : 0;
    var ss = $('sc-stats-summary');
    if (ss) ss.textContent = tot.t ? ('累计学习 ' + tot.t + ' 词 · 正确率 ' + tacc + '% · 已掌握 ' + master + ' 词') : '累计学习 0 词，开始训练后自动生成曲线';
    // 今日复习（艾宾浩斯到期）计数
    var due = dueList().length;
    var dn = $('sc-due-n'), dn2 = $('sc-due-n2'), tip = $('sc-review-tip');
    if (dn) dn.textContent = due;
    if (dn2) dn2.textContent = due;
    if (tip) tip.textContent = due ? ('有 ' + due + ' 个单词到复习点了') : '按遗忘曲线安排，暂无待复习单词';
  }

  /* ---------- 记忆训练（翻卡/选义/选词/听音/拼写） ---------- */
  var trainCfg = { range: 'all', count: 20, mode: 'card' };
  var MODE_NAME = { card: '翻卡背诵', en2cn: '看词选义', cn2en: '看义选词', listen: '听音选义', spell: '拼写训练' };
  var quiz = null;   // {mode, pool, queue, idx, correct, answered, cur, answerIdx}

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function rangeWords(range) {
    if (range === 'all') return ALL;
    if (range === 'star') { var ids = loadStar(), it = []; for (var k = 0; k < ids.length; k++) if (BY_ID[ids[k]]) it.push(BY_ID[ids[k]]); return it; }
    if (range === 'master') { var mm = []; for (var m = 0; m < ALL.length; m++) if (getStatus(ALL[m].id) === 'master') mm.push(ALL[m]); return mm; }
    return BY_CAT[range] || ALL;
  }
  function distractors(word, n) {
    var pool = (BY_CAT[word.kind] && BY_CAT[word.kind].length > n) ? BY_CAT[word.kind] : ALL;
    var out = [], seen = {}; seen[word.id] = 1; var guard = 0;
    while (out.length < n && guard < 300) {
      guard++;
      var c = pool[Math.floor(Math.random() * pool.length)];
      if (!c || seen[c.id] || !c.t) continue;
      seen[c.id] = 1; out.push(c);
    }
    return out;
  }
  function startSession(mode, words, title) {
    var q = shuffle(words).slice(0, trainCfg.count);
    if (!q.length) { toast('这个范围暂无单词'); return; }
    quiz = { mode: mode, pool: words, queue: q, idx: 0, correct: 0, answered: false, cur: null, answerIdx: 0 };
    $('sc-quiz-title').textContent = title || MODE_NAME[mode] || '训练';
    $('sc-quiz-result').classList.add('sc-hidden');
    showView('sc-view-quiz');
    renderQuestion();
  }
  function renderQuestion() {
    var w = quiz.queue[quiz.idx];
    quiz.cur = w; quiz.answered = false;
    $('sc-q-options').innerHTML = ''; $('sc-q-options').classList.add('sc-hidden');
    $('sc-q-spell').classList.add('sc-hidden');
    $('sc-q-card').classList.add('sc-hidden');
    $('sc-q-say').classList.add('sc-hidden');
    $('sc-q-feedback').className = 'sc-q-feedback sc-hidden';
    $('sc-q-next').classList.add('sc-hidden');
    $('sc-spell-input').value = '';
    $('sc-quiz-prog').textContent = (quiz.idx + 1) + ' / ' + quiz.queue.length;
    $('sc-quiz-score').textContent = quiz.correct + ' ✓';
    $('sc-quiz-bar').style.width = Math.round(quiz.idx / quiz.queue.length * 100) + '%';

    var mode = quiz.mode;
    if (mode === 'card') {
      $('sc-q-prompt').className = 'sc-q-prompt'; $('sc-q-prompt').textContent = w.w;
      $('sc-q-sub').textContent = w.p ? '/' + w.p + '/' : '';
      $('sc-q-say').classList.remove('sc-hidden');
      $('sc-q-card').classList.remove('sc-hidden');
      var rev = $('sc-card-reveal'); rev.className = 'sc-card-reveal'; rev.textContent = '点击卡片显示释义';
      $('sc-card-grade').classList.add('sc-hidden');
    } else if (mode === 'en2cn') {
      $('sc-q-prompt').className = 'sc-q-prompt'; $('sc-q-prompt').textContent = w.w;
      $('sc-q-sub').textContent = w.p ? '/' + w.p + '/' : '';
      $('sc-q-say').classList.remove('sc-hidden');
      buildOptions('t', w);
    } else if (mode === 'listen') {
      $('sc-q-prompt').className = 'sc-q-prompt'; $('sc-q-prompt').textContent = '🔊 听音选义';
      $('sc-q-sub').textContent = '（点击“再听一遍”可重听）';
      $('sc-q-say').classList.remove('sc-hidden');
      buildOptions('t', w);
      speak(w.w);
    } else if (mode === 'cn2en') {
      $('sc-q-prompt').className = 'sc-q-prompt sc-q-cn'; $('sc-q-prompt').textContent = w.t;
      $('sc-q-sub').textContent = '';
      buildOptions('w', w);
    } else if (mode === 'spell') {
      $('sc-q-prompt').className = 'sc-q-prompt sc-q-cn'; $('sc-q-prompt').textContent = w.t;
      $('sc-q-sub').textContent = w.p ? '/' + w.p + '/' : '';
      $('sc-q-say').classList.remove('sc-hidden');
      $('sc-q-spell').classList.remove('sc-hidden');
    }
    window.scrollTo(0, 0);
  }
  function buildOptions(field, w) {
    var ds = distractors(w, 3);
    var opts = shuffle([w].concat(ds));
    quiz.answerIdx = 0;
    var box = $('sc-q-options'); box.classList.remove('sc-hidden'); box.innerHTML = '';
    for (var k = 0; k < opts.length; k++) {
      var o = opts[k];
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'sc-opt'; btn.setAttribute('data-i', k);
      btn.textContent = field === 't' ? o.t : o.w;
      if (o.id === w.id) quiz.answerIdx = k;
      box.appendChild(btn);
    }
  }
  function markOptions(chosenIdx) {
    var box = $('sc-q-options'), kids = box.children;
    for (var k = 0; k < kids.length; k++) {
      if (k === quiz.answerIdx) kids[k].classList.add('sc-correct');
      else if (k === chosenIdx) kids[k].classList.add('sc-wrong');
      kids[k].classList.add('sc-locked');
    }
  }
  function afterAnswer(ok) {
    if (quiz.answered) return;
    quiz.answered = true;
    var w = quiz.cur;
    if (ok) quiz.correct++;
    var prev = getStatus(w.id);
    srsUpdate(w.id, ok);
    var becameMaster = false;
    if (!ok) setStatus(w.id, 'learning');
    else { var e = srsAll()[w.id]; if (e && e.step >= 3) { setStatus(w.id, 'master'); becameMaster = (prev !== 'master'); } }
    logStat(ok, becameMaster);
    $('sc-quiz-score').textContent = quiz.correct + ' ✓';
    showFeedback(ok, w);
    $('sc-q-next').classList.remove('sc-hidden');
    $('sc-q-next').textContent = (quiz.idx >= quiz.queue.length - 1) ? '完成 ✓' : '下一个 ›';
  }
  function showFeedback(ok, w) {
    var fb = $('sc-q-feedback');
    var extra = w.e ? ('<br><span style="opacity:.85">' + esc(w.e) + (w.ec ? '　' + esc(w.ec) : '') + '</span>') : '';
    fb.className = 'sc-q-feedback ' + (ok ? 'sc-ok' : 'sc-no');
    fb.innerHTML = (ok ? '✓ 回答正确　' : '✗ 正确答案：') + '<b>' + esc(w.w) + '</b> ' + esc(w.t) + extra;
  }
  function nextQuestion() {
    if (quiz.idx >= quiz.queue.length - 1) { showResult(); return; }
    quiz.idx++; renderQuestion();
  }
  function showResult() {
    var total = quiz.queue.length, c = quiz.correct;
    $('sc-quiz-bar').style.width = '100%';
    $('sc-quiz-prog').textContent = total + ' 词';
    $('sc-q-prompt').textContent = ''; $('sc-q-sub').textContent = '';
    $('sc-q-options').classList.add('sc-hidden'); $('sc-q-spell').classList.add('sc-hidden');
    $('sc-q-card').classList.add('sc-hidden'); $('sc-q-say').classList.add('sc-hidden');
    $('sc-q-feedback').className = 'sc-q-feedback sc-hidden'; $('sc-q-next').classList.add('sc-hidden');
    var pct = total ? Math.round(c / total * 100) : 0;
    var r = $('sc-quiz-result'); r.classList.remove('sc-hidden');
    r.innerHTML = '<div class="sc-res-big">' + pct + '%</div>' +
      '<div class="sc-res-line">答对 ' + c + ' / ' + total + ' 词</div>' +
      '<button type="button" id="sc-again" class="sc-btn-primary sc-block">再来一轮</button>' +
      '<button type="button" id="sc-back-home" class="sc-btn-ghost sc-block">返回首页</button>';
    var m = quiz.mode, p = quiz.pool;
    $('sc-again').onclick = function () { startSession(m, p); };
    $('sc-back-home').onclick = function () { showView('sc-view-home'); refreshCounts(); };
    refreshCounts();
  }
  function cardReveal() {
    var rev = $('sc-card-reveal');
    if (rev.className.indexOf('sc-shown') !== -1) return;
    var w = quiz.cur;
    rev.className = 'sc-card-reveal sc-shown';
    rev.innerHTML = '<b>' + esc(w.w) + '</b>' + (w.p ? ' /' + esc(w.p) + '/' : '') + '<br>' + esc(w.t) +
      (w.e ? '<br><span style="font-size:14px;opacity:.82">' + esc(w.e) + '</span>' : '');
    $('sc-card-grade').classList.remove('sc-hidden');
  }
  function cardGrade(g) {
    if (quiz.answered) return;
    var w = quiz.cur, ok = (g === 'know'), prev = getStatus(w.id);
    var becameMaster = false;
    if (g === 'know') { setStatus(w.id, 'master'); srsUpdate(w.id, true); becameMaster = (prev !== 'master'); }
    else { setStatus(w.id, 'learning'); srsUpdate(w.id, false); }
    logStat(ok, becameMaster);
    quiz.answered = true;
    if (ok) quiz.correct++;
    $('sc-quiz-score').textContent = quiz.correct + ' ✓';
    $('sc-card-grade').classList.add('sc-hidden');
    $('sc-q-next').classList.remove('sc-hidden');
    $('sc-q-next').textContent = (quiz.idx >= quiz.queue.length - 1) ? '完成 ✓' : '下一个 ›';
  }
  function submitSpell() {
    if (quiz.answered) return;
    var val = ($('sc-spell-input').value || '').trim().toLowerCase();
    if (!val) { toast('请输入单词'); return; }
    afterAnswer(val === quiz.cur.w.toLowerCase());
  }
  function startReview() {
    var due = dueList();
    if (!due.length) { toast('暂无待复习单词，先去训练吧'); return; }
    if (trainCfg.count < due.length) trainCfg.count = due.length;
    startSession('card', due, '今日复习');
  }
  function segPick(container, e, attr, cb) {
    var b = e.target;
    while (b && b !== container && !(b.getAttribute && b.getAttribute(attr))) b = b.parentNode;
    if (b === container) return;
    cb(b.getAttribute(attr));
    var kids = container.children;
    for (var k = 0; k < kids.length; k++) kids[k].classList.toggle('sc-on', kids[k] === b);
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    var tabs = document.querySelectorAll('.sc-tabbar button');
    for (var t = 0; t < tabs.length; t++) {
      (function (btn) {
        btn.onclick = function () {
          if (btn.getAttribute('data-view')) showView(btn.getAttribute('data-view'));
          else setListByType(btn.getAttribute('data-view-list'));
        };
      })(tabs[t]);
    }
    // 首页分类卡
    var cats = document.querySelectorAll('.sc-cat-card');
    for (var c = 0; c < cats.length; c++) {
      (function (btn) {
        btn.onclick = function () {
          if (btn.getAttribute('data-list')) setListByType(btn.getAttribute('data-list'));
          else if (btn.getAttribute('data-nav')) {
            if (btn.getAttribute('data-nav') === 'sc-view-sentfav') renderSentFav();
            showView(btn.getAttribute('data-nav'));
          }
        };
      })(cats[c]);
    }
    $('sc-btn-random').onclick = function () {
      if (!ALL.length) return;
      openWord(ALL, Math.floor(Math.random() * ALL.length));
    };

    // 每日一句
    $('sc-daily-switch').onclick = function () { showSentence(true); };
    $('sc-daily-speak').onclick = function () { speak(SENTENCES[sentIdx] ? SENTENCES[sentIdx].en : ''); };
    $('sc-daily-fav').onclick = function () {
      var s = SENTENCES[sentIdx]; if (!s) return;
      var added = toggleSentFav(s.en);
      $('sc-daily-fav').textContent = added ? '★ 已收藏' : '☆ 收藏句子';
      $('sc-daily-fav').classList.toggle('sc-faved', added);
      toast(added ? '已收藏这句' : '已取消收藏');
    };

    // 打卡
    $('sc-checkin-btn').onclick = doCheckin;

    // 搜索
    $('sc-search-btn').onclick = function () { doSearch($('sc-search-input').value); };
    $('sc-search-input').onkeydown = function (e) { if (e.keyCode === 13) doSearch(this.value); };

    // 列表条目点击（事件委托：回溯到带 data-id 的 <li>）
    $('sc-word-list').onclick = function (e) {
      var el = e.target;
      while (el && el !== this && !(el.getAttribute && el.getAttribute('data-id'))) el = el.parentNode;
      if (!el || el === this) return;
      openWordById(el.getAttribute('data-id'), listCtx ? listCtx.items : ALL);
    };
    $('sc-load-more').onclick = loadBatch;
    $('sc-list-back').onclick = function () { showView('sc-view-home'); };

    // 单词详情
    $('sc-word-back').onclick = wordBack;
    $('sc-say-word').onclick = function () { var w = wordCtx.items[wordCtx.index]; speak(w.w); };
    $('sc-say-example').onclick = function () { var w = wordCtx.items[wordCtx.index]; if (w.e) speak(w.e); };
    $('sc-word-star').onclick = function () {
      var w = wordCtx.items[wordCtx.index];
      var added = toggleStar(w.id);
      $('sc-word-star').textContent = added ? '★' : '☆';
      $('sc-word-star').classList.toggle('sc-faved', added);
      refreshListDot(w.id);
      toast(added ? '已加入生词本' : '已从生词本移除');
    };
    $('sc-mastery-row').onclick = function (e) {
      var btn = e.target;
      if (!btn.getAttribute || !btn.getAttribute('data-level')) return;
      var w = wordCtx.items[wordCtx.index];
      setStatus(w.id, btn.getAttribute('data-level'));
      refreshListDot(w.id);
      renderWord();
    };
    $('sc-word-prev').onclick = function () { if (wordCtx.index > 0) { wordCtx.index--; renderWord(); window.scrollTo(0, 0); } };
    $('sc-word-next').onclick = function () { if (wordCtx.index < wordCtx.items.length - 1) { wordCtx.index++; renderWord(); window.scrollTo(0, 0); } };

    // 我藏的句子
    $('sc-sentfav-back').onclick = function () { showView('sc-view-home'); };
    $('sc-sentfav-wrap').onclick = function (e) {
      var btn = e.target;
      while (btn && btn !== this && !(btn.getAttribute && btn.getAttribute('data-act'))) btn = btn.parentNode;
      if (btn === this) return;
      var item = btn.parentNode;
      while (item && item !== this && !(item.getAttribute && item.getAttribute('data-en'))) item = item.parentNode;
      if (!item || item === this) return;
      var en = item.getAttribute('data-en');
      if (btn.getAttribute('data-act') === 'say') speak(en);
      else {
        toggleSentFav(en);
        renderSentFav();
        var s = SENTENCES[sentIdx];
        if (s && s.en === en) showSentence(false);
        toast('已取消收藏');
      }
    };

    // 记忆训练：首页入口
    $('sc-go-train').onclick = function () { showView('sc-view-train'); };
    $('sc-go-review').onclick = function () { startReview(); };
    // 学习曲线
    $('sc-go-stats').onclick = function () { renderStats(); showView('sc-view-stats'); };
    $('sc-stats-back').onclick = function () { showView('sc-view-home'); refreshCounts(); };
    $('sc-stats-range').onclick = function (e) { segPick(this, e, 'data-days', function (v) { statsRange = parseInt(v, 10) || 14; renderStats(); }); };
    // 训练设置页
    $('sc-train-back').onclick = function () { showView('sc-view-home'); };
    $('sc-train-range').onclick = function (e) { segPick(this, e, 'data-range', function (v) { trainCfg.range = v; }); };
    $('sc-train-count').onclick = function (e) { segPick(this, e, 'data-count', function (v) { trainCfg.count = parseInt(v, 10) || 20; }); };
    $('sc-train-modes').onclick = function (e) { segPick(this, e, 'data-mode', function (v) { trainCfg.mode = v; }); };
    $('sc-train-start').onclick = function () {
      var words = rangeWords(trainCfg.range);
      if (!words.length) { toast('这个范围还没有单词，先去词书里逛逛'); return; }
      startSession(trainCfg.mode, words, MODE_NAME[trainCfg.mode]);
    };
    $('sc-train-review').onclick = function () { startReview(); };
    // 答题页
    $('sc-quiz-quit').onclick = function () { quiz = null; showView('sc-view-home'); refreshCounts(); };
    $('sc-q-say-btn').onclick = function () { if (quiz && quiz.cur) speak(quiz.cur.w); };
    // 选项点击（事件委托）
    $('sc-q-options').onclick = function (e) {
      if (!quiz || quiz.answered) return;
      var btn = e.target;
      while (btn && btn !== this && !(btn.getAttribute && btn.getAttribute('data-i'))) btn = btn.parentNode;
      if (!btn || btn === this) return;
      var i = parseInt(btn.getAttribute('data-i'), 10);
      markOptions(i);
      afterAnswer(i === quiz.answerIdx);
    };
    // 拼写
    $('sc-spell-submit').onclick = function () { submitSpell(); };
    $('sc-spell-input').onkeydown = function (e) { if (e.keyCode === 13) submitSpell(); };
    // 翻卡
    $('sc-card-reveal').onclick = function () { cardReveal(); };
    $('sc-card-grade').onclick = function (e) {
      var btn = e.target;
      while (btn && btn !== this && !(btn.getAttribute && btn.getAttribute('data-grade'))) btn = btn.parentNode;
      if (!btn || btn === this) return;
      cardGrade(btn.getAttribute('data-grade'));
    };
    // 下一题
    $('sc-q-next').onclick = function () { nextQuestion(); };
  }

  /* ---------- Service Worker（单文件 file:// 打开时自动跳过） ---------- */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    });
  }

  /* ---------- 首次进入 ---------- */
  function init() {
    var d = new Date(), p2 = function (x) { return x < 10 ? '0' + x : '' + x; };
    var week = ['日', '一', '二', '三', '四', '五', '六'];
    $('sc-home-date').textContent = d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · 星期' + week[d.getDay()];
    var ver = 'v1.0.0';
    try {
      var m = document.querySelector('meta[name="app-version"]');
      if (m) ver = m.getAttribute('content');
    } catch (e) {}
    $('sc-version-line').textContent = '词海 WordSea ' + ver + ' · ' + SC_VERSION;

    bindEvents();
    refreshCounts();
    sentIdx = daySentenceIdx();
    showSentence(false);
    renderCheckin();
    if (!ALL.length) toast('未加载到词库数据，请检查 data-*.js');
  }
  init();
})();
