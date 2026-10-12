/* Analytics without cookies or IPs: a random id per tab, page, clicked links, referring site, utm_* tags.
   Nothing is sent with Do-Not-Track or GPC on. Batches to /api/events every 10 s and on page hide. */
(function (w, d) {
  var n = w.navigator || {};
  if (n.doNotTrack == '1' || w.doNotTrack == '1' || n.globalPrivacyControl) return;
  var sid, K = 'eps-sid', U = '/api/events', q = [], path = w.location.pathname || '/', seen = {};
  try { sid = w.sessionStorage.getItem(K); } catch (e) {}
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(sid || '')) {
    var a = new Uint8Array(12);
    w.crypto.getRandomValues(a);
    sid = Array.prototype.map.call(a, function (b) { return (b + 256).toString(16).slice(1); }).join('');
    try { w.sessionStorage.setItem(K, sid); } catch (e) {}
  }
  var push = function (k, x) {
    var e = { s: sid, p: path, k: k };
    for (var i in x) if (x[i]) e[i] = x[i];
    q.push(e);
    if (q.length >= 20) send();
  };
  var send = function (beacon) {
    if (!q.length) return;
    var body = JSON.stringify({ e: q.splice(0, 20) });
    try {
      if (beacon && n.sendBeacon && n.sendBeacon(U, new w.Blob([body], { type: 'text/plain' }))) return;
      w.fetch(U, { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(function () {});
    } catch (e) {}
  };

  var ref = '', utm = {}, has = 0;
  try { ref = d.referrer && new w.URL(d.referrer).hostname.toLowerCase(); } catch (e) {}
  try {
    var sp = new w.URLSearchParams(w.location.search);
    ['source', 'medium', 'campaign', 'term', 'content'].forEach(function (k) {
      var v = sp.get('utm_' + k);
      if (v) { utm[k] = v.slice(0, 100); has = 1; }
    });
  } catch (e) {}
  push('view', { r: ref, u: has ? utm : 0 });

  d.addEventListener('click', function (ev) {
    var el = ev.target && ev.target.closest && ev.target.closest('a[href]');
    if (!el) return;
    try {
      var u = new w.URL(el.href, w.location.href), t = /^(mailto|tel):$/.test(u.protocol) ? u.protocol.slice(0, -1)
        : u.host === w.location.host ? u.pathname : 'out:' + u.hostname;
      push('click', { t: t.slice(0, 300) });
    } catch (e) {}
  }, true);

  /* /start wizard: #wiz-count "03 / 07" is the step; 07 with Back hidden is the thank-you */
  var cnt = d.getElementById('wiz-count');
  if (cnt && w.MutationObserver) {
    var step = function () {
      var m = /^(\d+)/.exec(cnt.textContent || ''), back = d.getElementById('wiz-back');
      if (!m) return;
      var k = +m[1] === 7 && back && back.hidden ? 'submit' : m[1].replace(/^0+/, '');
      if (seen[k]) return;
      seen[k] = 1;
      push(k === 'submit' ? 'start_submit' : 'start_step', { t: k === 'submit' ? 0 : k });
    };
    new w.MutationObserver(step).observe(cnt, { childList: true, characterData: true, subtree: true });
    step();
  }

  w.setInterval(send, 10000);
  d.addEventListener('visibilitychange', function () { if (d.visibilityState === 'hidden') send(1); });
  w.addEventListener('pagehide', function () { send(1); });
})(window, document);
