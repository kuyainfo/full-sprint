/* =====================================================================
   全速衝刺 FULL SPRINT — 共用核心（設定 / 資料庫 / 物理引擎 / 偽 3D 繪圖）
   玩家端 index.html、投影端 tv.html、後台 admin.html 都會載入這支檔案
   ===================================================================== */
(function () {
  'use strict';

  /* ───────── ① Firebase 設定（三個頁面共用這一份） ─────────
     沿用 Kuya-Candy Game 專案（已升 Blaze），資料放在 full_sprint 節點。
     改成 null ＝「本機測試模式」；或網址加 ?local=1 也會進本機測試模式。 */
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDl_NqANwk_lsfEL5kOyC1RJi29DLvGPU8",
    authDomain: "kuya-candy-game.firebaseapp.com",
    databaseURL: "https://kuya-candy-game-default-rtdb.firebaseio.com",
    projectId: "kuya-candy-game",
    storageBucket: "kuya-candy-game.firebasestorage.app",
    messagingSenderId: "105923267148",
    appId: "1:105923267148:web:1f0e0db9de8cc2876c42e9"
  };
  const FORCE_LOCAL = /[?&]local=1\b/.test(location.search);
  const USE_FB = !!FIREBASE_CONFIG && !FORCE_LOCAL;

  const ROOT = 'full_sprint';
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const LAPS = 3;

  /* 後台可調的預設值 */
  const DEFAULT_CFG = {
    lapLen: 1000,          // 每圈長度（公尺）；一般人約 22–28 秒一圈
    grace: 20,             // 第一名衝線後倒數秒數
    maxTime: 180,          // 最長比賽秒數（保險）
    zone: [30, 22, 15],    // 每圈綠區寬度（轉速表 %）
    curves: [2, 3, 4],     // 每圈彎道數
    nitroPer: 3,           // 車隊平均每人幾次 Perfect 換檔集滿氮氣
    nitroSec: 3,           // 氮氣加速秒數
    mech: { shift: true, curve: true, nitro: true, start: true },
    practice: true,        // 是否開放試玩
    loginMode: 'name',     // name＝姓名＋桌號｜emp＝員工編號（需匯入名單）
    teamMode: 'table',     // table＝依桌號｜choose＝自選｜auto＝自動平均｜list＝依匯入名單
    teamCap: 0,            // 自選隊伍時每隊人數上限（0＝不限）
    tables: '1-30',        // 桌號清單（可寫 1-30,VIP,主桌）
    teams: [
      { n: '紅隊', c: '#ff2d55', tb: '1-10' },
      { n: '藍隊', c: '#1e9bff', tb: '11-20' },
      { n: '黃隊', c: '#ffc21a', tb: '21-30' }
    ],
    brand: 'FULL SPRINT',  // 路邊看板文字
    logo: ''               // 路邊看板 Logo 圖片網址（例如 logo.png，放在同一個資料夾）
  };

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res;
      s.onerror = () => rej(new Error('載入失敗：' + src));
      document.head.appendChild(s);
    });
  }

  /* ───────── Firebase 後端 ───────── */
  const FB = {
    async init() {
      await loadScript(SDK + 'firebase-app-compat.js');
      await loadScript(SDK + 'firebase-database-compat.js');
      firebase.initializeApp(FIREBASE_CONFIG);
      this.db = firebase.app().database(FIREBASE_CONFIG.databaseURL);
      this.offset = 0;
      this.db.ref('.info/serverTimeOffset').on('value', s => { this.offset = s.val() || 0; });
    },
    r(p) { return this.db.ref(p); },
    on(p, cb) {
      const ref = this.r(p); const h = s => cb(s.val());
      ref.on('value', h); return () => ref.off('value', h);
    },
    onTop(p, child, n, cb) {
      const q = this.r(p).orderByChild(child).limitToLast(n);
      const h = s => {
        const a = [];
        s.forEach(c => { const v = c.val(); if (v && typeof v === 'object') a.push(Object.assign({ key: c.key }, v)); });
        a.reverse(); cb(a);
      };
      q.on('value', h); return () => q.off('value', h);
    },
    get(p) { return this.r(p).once('value').then(s => s.val()); },
    set(p, v) { return this.r(p).set(v); },
    update(p, o) { return this.r(p).update(o); },
    remove(p) { return this.r(p).remove(); },
    txn(p, fn) { return this.r(p).transaction(fn).then(r => ({ committed: r.committed, val: r.snapshot.val() })); },
    now() { return Date.now() + this.offset; },
    onConnected(cb) { this.r('.info/connected').on('value', s => cb(s.val() === true)); }
  };

  /* ───────── 本機測試後端（localStorage，同一瀏覽器多分頁互通） ───────── */
  const LP = 'fsmock:';
  const LOCAL = {
    listeners: new Set(), pending: false,
    async init() {
      window.addEventListener('storage', e => { if (!e.key || e.key.startsWith(LP)) this.notify(); });
    },
    norm(p) { return String(p).replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/'); },
    keys() {
      const a = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(LP)) a.push(k); }
      return a;
    },
    read(p) {
      p = this.norm(p);
      const exact = localStorage.getItem(LP + p);
      if (exact !== null) return JSON.parse(exact);
      const pre = LP + p + '/'; let out = null;
      for (const k of this.keys()) {
        if (!k.startsWith(pre)) continue;
        const parts = k.slice(pre.length).split('/');
        out = out || {}; let o = out;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
          o = o[parts[i]];
        }
        o[parts[parts.length - 1]] = JSON.parse(localStorage.getItem(k));
      }
      return out;
    },
    writeRaw(p, v) {
      p = this.norm(p);
      const parts = p.split('/');
      for (let i = 1; i < parts.length; i++) localStorage.removeItem(LP + parts.slice(0, i).join('/'));
      localStorage.removeItem(LP + p);
      const pre = LP + p + '/';
      for (const k of this.keys()) if (k.startsWith(pre)) localStorage.removeItem(k);
      this.flat(p, v);
    },
    flat(p, v) {
      if (v === null || v === undefined) return;
      if (typeof v === 'object') { for (const k in v) this.flat(p + '/' + k, v[k]); }
      else localStorage.setItem(LP + p, JSON.stringify(v));
    },
    set(p, v) { this.writeRaw(p, v); this.notify(); return Promise.resolve(); },
    update(p, o) { for (const k in o) this.writeRaw(p + '/' + k, o[k]); this.notify(); return Promise.resolve(); },
    remove(p) { this.writeRaw(p, null); this.notify(); return Promise.resolve(); },
    get(p) { return Promise.resolve(this.read(p)); },
    txn(p, fn) {
      const cur = this.read(p); const nv = fn(cur);
      if (nv === undefined) return Promise.resolve({ committed: false, val: cur });
      this.writeRaw(p, nv); this.notify();
      return Promise.resolve({ committed: true, val: this.read(p) });
    },
    on(p, cb) { const L = { kind: 'v', p, cb }; this.listeners.add(L); setTimeout(() => this.fire(L), 0); return () => this.listeners.delete(L); },
    onTop(p, child, n, cb) { const L = { kind: 'top', p, child, n, cb }; this.listeners.add(L); setTimeout(() => this.fire(L), 0); return () => this.listeners.delete(L); },
    compute(L) {
      const v = this.read(L.p);
      if (L.kind === 'v') return v;
      return Object.entries(v || {})
        .filter(([, x]) => x && typeof x === 'object' && typeof x[L.child] === 'number')
        .map(([k, x]) => Object.assign({ key: k }, x))
        .sort((a, b) => b[L.child] - a[L.child]).slice(0, L.n);
    },
    fire(L) {
      if (!this.listeners.has(L)) return;
      const v = this.compute(L); const j = JSON.stringify(v);
      if (j === L.last) return; L.last = j;
      try { L.cb(v); } catch (e) { console.error(e); }
    },
    notify() {
      if (this.pending) return; this.pending = true;
      setTimeout(() => { this.pending = false; for (const L of this.listeners) this.fire(L); }, 16);
    },
    now() { return Date.now(); },
    onConnected(cb) { setTimeout(() => cb(true), 0); }
  };

  /* ───────── 工具 ───────── */
  function hash(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function strHash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const toArr = x => Array.isArray(x) ? x.filter(v => v != null) : (x && typeof x === 'object' ? Object.keys(x).sort((a, b) => a - b).map(k => x[k]) : []);
  function hexRgb(h) { h = String(h || '#888').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgba(h, a) { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; }
  function shade(h, k) { const [r, g, b] = hexRgb(h); const f = v => Math.round(clamp(k > 0 ? v + (255 - v) * k : v * (1 + k), 0, 255)); return `rgb(${f(r)},${f(g)},${f(b)})`; }

  /* 桌號清單："1-30,VIP,主桌" → ['1',...,'30','VIP','主桌'] */
  function parseTables(str) {
    const out = [];
    String(str || '').split(/[,，、\s]+/).forEach(t => {
      t = t.trim(); if (!t) return;
      const m = t.match(/^(\d+)\s*[-~～]\s*(\d+)$/);
      if (m) { let a = +m[1], b = +m[2]; if (a > b) [a, b] = [b, a]; for (let i = a; i <= b && out.length < 500; i++) out.push(String(i)); }
      else out.push(t.slice(0, 10));
    });
    return [...new Set(out)];
  }

  const GS = window.GS = {
    ROOT, LAPS, DEFAULT_CFG, LOCAL_MODE: !USE_FB, db: null, hash, strHash, clamp, rgba, shade, parseTables, toArr,
    async ready() {
      const b = USE_FB ? FB : LOCAL;
      await b.init(); GS.db = b;
      if (!USE_FB) {
        const tag = document.createElement('div');
        tag.textContent = '本機測試模式';
        tag.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;font:12px sans-serif;color:#fff;background:rgba(200,30,60,.85);padding:3px 8px;border-radius:10px;pointer-events:none';
        document.body.appendChild(tag);
      }
      return b;
    },
    p(sub) { return ROOT + '/' + sub; },
    cleanName(n) { return String(n || '').replace(/[.#$\[\]\/\\<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 10); },
    cleanKey(n) { return String(n || '').replace(/[.#$\[\]\/\\<>\s]/g, '').trim().slice(0, 20); },
    uid() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },
    cfgOf(g) {
      const src = (g && g.cfg) || {};
      const c = Object.assign({}, DEFAULT_CFG, src);
      c.mech = Object.assign({}, DEFAULT_CFG.mech, src.mech || {});
      const za = toArr(src.zone), ca = toArr(src.curves);
      c.zone = [0, 1, 2].map(i => clamp(+(za[i] != null ? za[i] : DEFAULT_CFG.zone[i]) || DEFAULT_CFG.zone[i], 5, 60));
      c.curves = [0, 1, 2].map(i => clamp(Math.round(+(ca[i] != null ? ca[i] : DEFAULT_CFG.curves[i])), 0, 8));
      const ta = toArr(src.teams);
      c.teams = (ta.length ? ta : DEFAULT_CFG.teams).map((t, i) => ({ n: String(t.n || ('車隊' + (i + 1))), c: t.c || '#888888', tb: String(t.tb || '') }));
      return c;
    },
    tableList(cfg) { return parseTables(cfg.tables); },
    /* 依桌號找車隊；沒設定到的桌號依順序輪流分配 */
    teamOfTable(cfg, tb) {
      tb = String(tb);
      for (let i = 0; i < cfg.teams.length; i++) if (parseTables(cfg.teams[i].tb).includes(tb)) return i;
      const list = parseTables(cfg.tables), k = list.indexOf(tb);
      return (k >= 0 ? k : Math.floor(strHash(tb) * 97)) % Math.max(1, cfg.teams.length);
    },
    team(cfg, i) { return cfg.teams[i] || { n: '車隊', c: '#888888' }; },
    /* 排序分數：已衝線者依衝線順序排最前，其餘依距離 */
    score(d, f) { return f ? 2000000 - f : Math.floor(d); },
    /* 結束時間：最長時間 / 第一名衝線+倒數 / 強制結束，取最早 */
    endAt(g, fin) {
      if (!g || !g.startAt) return Infinity;
      const c = GS.cfgOf(g);
      let e = g.startAt + c.maxTime * 1000;
      if (fin && fin.firstAt) e = Math.min(e, fin.firstAt + c.grace * 1000);
      if (g.forceEndAt) e = Math.min(e, g.forceEndAt);
      return e;
    },
    LIGHTS: 5, LIGHT_MS: 900,

    /* ═════════════ 賽道 ═════════════ */
    track(cfg) {
      const L = cfg.lapLen, curves = [];
      if (cfg.mech.curve) {
        for (let lap = 0; lap < LAPS; lap++) {
          const n = cfg.curves[lap];
          for (let k = 0; k < n; k++) {
            const s = Math.round(lap * L + L * (0.12 + 0.76 * (k + 0.5) / n));
            curves.push({ s, len: 80, dir: hash(lap * 13 + k * 5 + 1) > 0.5 ? 1 : -1, lap });
          }
        }
      }
      return { L, laps: LAPS, total: L * LAPS, curves, zone: cfg.zone.slice() };
    },
    practiceTrack(cfg) {
      return { L: 700, laps: 1, total: 700, practice: true, zone: [Math.max(cfg.zone[0], 25)],
        curves: cfg.mech.curve ? [{ s: 300, len: 80, dir: 1, lap: 0 }, { s: 530, len: 80, dir: -1, lap: 0 }] : [] };
    },

    /* ═════════════ 物理引擎 ═════════════ */
    GEARS: [0, 20, 32, 44, 56, 68],   // 各檔極速（m/s）
    ZHI: 0.88, RED: 0.92,
    RISE: [0, 0.32, 0.38, 0.46, 0.55, 0.65],   // 按住油門時各檔轉速上升速度（每秒）
    Car: null,

    /* ═════════════ 繪圖 ═════════════ */
    SEG: 4, ROADW: 9, CURV: 0.065,
    curveAt(tr, z) {
      const cs = tr.curves;
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i], a = c.s - 30, b = c.s + c.len + 30;
        if (z < a) break;
        if (z < b) return c.dir * Math.sin((z - a) / (b - a) * Math.PI);
      }
      return 0;
    },
    hillAt(z) { return 5 * Math.sin(z / 170) + 2.5 * Math.sin(z / 63 + 1.2); }
  };

  /* ───────── 車輛（玩家端與試玩共用） ───────── */
  class Car {
    constructor(tr, mech, onEv) {
      this.tr = tr; this.mech = mech; this.onEv = onEv || (() => { });
      this.d = 0; this.v = 0; this.g = 1; this.rpm = 0; this.pc = 0; this.hold = false;
      this.go = false; this.goAt = 0; this.done = false; this.jumped = false; this.firstTap = 0;
      this.stallUntil = 0; this.lockUntil = 0; this.boostUntil = 0; this.nitroUntil = 0; this.slipUntil = 0;
      this.redT = 0; this.ci = 0; this.inCurve = false; this.curveT = 0; this.slipped = false; this.warn = null;
      this.over = false; this.out5 = false;
    }
    emit(k, x) { try { this.onEv(k, x); } catch (e) { console.error(e); } }
    restore(d, pc) {
      this.d = d || 0; this.pc = pc || 0; this.g = this.d > 0 ? 3 : 1; this.rpm = this.d > 0 ? 0.5 : 0;
      while (this.ci < this.tr.curves.length && this.tr.curves[this.ci].s + this.tr.curves[this.ci].len < this.d) this.ci++;
    }
    lap() { return Math.min(this.tr.laps - 1, Math.floor(this.d / this.tr.L)); }
    zone() { const w = (this.tr.zone[this.lap()] || this.tr.zone[0]) / 100; return [GS.ZHI - w, GS.ZHI]; }
    locked(now) { return this.done || now < this.stallUntil || now < this.lockUntil; }
    start(now) { this.go = true; this.goAt = now; if (this.jumped) this.lockUntil = now + 1000; }
    /* 按住／放開油門 */
    setHold(on, now) {
      if (this.done) { this.hold = false; return; }
      if (on && !this.hold) {
        if (!this.go) { if (this.mech.start && !this.jumped) { this.jumped = true; this.emit('jump'); } }
        else if (!this.firstTap) {
          this.firstTap = now || 1;
          if (this.mech.start && !this.jumped && now - this.goAt < 500) { this.rpm = 0.55; this.v = 6; this.emit('launch'); }
        }
      }
      this.hold = !!on;
    }
    shift(now) {
      if (!this.mech.shift || !this.go || this.locked(now)) return;
      if (this.g >= 5) { this.emit('top'); return; }
      const [lo, hi] = this.zone(), r = this.rpm;
      this.g++;
      if (r >= lo && r <= hi) { this.rpm = 0.45; this.boostUntil = now + 1000; this.pc++; this.emit('perfect'); }
      else if (r < lo) { this.rpm = Math.max(0.15, r * 0.55); this.v *= 0.95; this.emit('early'); }
      else { this.rpm = 0.45; this.v *= 0.9; this.emit('late'); }
    }
    step(dt, now) {
      if (!this.go || this.done) return;
      const locked = this.locked(now), [lo, hi] = this.zone();
      if (!this.mech.shift && this.rpm >= 0.84 && this.g < 5) { this.g++; this.rpm = 0.45; }
      if (this.hold && !locked) {
        if (!this.firstTap) this.firstTap = now || 1;
        this.rpm += GS.RISE[this.g] * dt;                       // 檔位越高，指針爬得越快
        if (this.inCurve && !this.slipped && now - this.curveT > 250) {
          this.slipped = true; this.v *= 0.6; this.rpm *= 0.6; this.slipUntil = now + 900; this.emit('slip');
        }
      } else this.rpm -= (this.inCurve ? 0.25 : 0.45) * dt;   // 放開：指針往下掉
      this.rpm = Math.max(0, Math.min(1, this.rpm));
      if (!this.mech.shift) this.rpm = Math.min(this.rpm, 0.9);
      if (this.mech.shift && this.rpm >= GS.RED && now >= this.stallUntil) {
        this.redT += dt;
        if (this.redT > 1) { this.stallUntil = now + 1500; this.rpm = 0.15; this.redT = 0; this.emit('stall'); }
      } else this.redT = 0;
      // 出綠區懲罰：任何檔位超出綠區＝過轉掉速；5 檔掉到綠區下方＝出綠區
      this.over = this.mech.shift && this.rpm > hi && !locked;
      this.out5 = this.mech.shift && this.g === 5 && this.rpm < lo && !locked && !this.inCurve && !this.warn;
      let tv = GS.GEARS[this.g] * (0.25 + 0.75 * Math.min(this.rpm, 0.9) / 0.9);
      if (this.over) tv *= 0.88;
      if (now < this.stallUntil || now < this.lockUntil) tv = 0;
      if (now < this.boostUntil) tv *= 1.15;
      if (now < this.nitroUntil) tv *= 1.35;
      if (this.inCurve && !(now < this.stallUntil || now < this.lockUntil)) tv = this.slipped ? 18 : Math.max(Math.min(tv, 34), 30);
      const k = tv > this.v ? 1.6 : (now < this.stallUntil ? 0.9 : 1.4);
      this.v += (tv - this.v) * Math.min(1, dt * k);
      if (this.v < 0) this.v = 0;
      this.d += this.v * dt;
      this.curves(now);
      if (this.d >= this.tr.total) { this.d = this.tr.total; this.done = true; this.hold = false; this.emit('finish'); }
    }
    curves(now) {
      const cs = this.tr.curves;
      while (this.ci < cs.length && this.d > cs[this.ci].s + cs[this.ci].len) {
        if (this.inCurve) {
          if (!this.slipped) { this.v *= 1.04; this.emit('corner'); }
          this.g = Math.min(this.g, 2); this.rpm = 0.6; this.inCurve = false;
        }
        this.ci++; this.slipped = false;
      }
      const c = cs[this.ci];
      if (!c) { this.warn = null; return; }
      const dist = c.s - this.d;
      if (dist <= 0) {
        if (!this.inCurve) { this.inCurve = true; this.curveT = now; this.slipped = false; this.emit('curveIn', c.dir); }
        this.warn = { dir: c.dir, dist: 0, active: true };
      } else if (dist < Math.max(45, this.v * 1.6)) {
        if (!this.warn) this.emit('curveWarn', c.dir);
        this.warn = { dir: c.dir, dist, active: false };
      } else this.warn = null;
    }
  }
  GS.Car = Car;

  /* ═════════════════════ 繪圖 ═════════════════════ */
  const spriteCache = {};
  function sprite(key, w, h, fn) {
    if (!spriteCache[key]) { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h); spriteCache[key] = c; }
    return spriteCache[key];
  }
  // 字型載入完成後，清掉含文字的快取貼圖（避免快取到還沒載入的字型）
  if (document.fonts) {
    const clearText = () => { for (const k in spriteCache) if (k.startsWith('board')) delete spriteCache[k]; };
    document.fonts.ready.then(clearText);
    try { document.fonts.addEventListener('loadingdone', clearText); } catch (e) { }
  }
  GS.sprite = sprite;
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  GS.rr = rr;

  /* 賽車（車尾視角） 260×150 */
  function carSprite(col) {
    return sprite('car' + col, 260, 150, (c) => {
      // 輪胎
      for (const x of [8, 198]) {
        const g = c.createLinearGradient(x, 0, x + 54, 0);
        g.addColorStop(0, '#050505'); g.addColorStop(0.5, '#262626'); g.addColorStop(1, '#050505');
        c.fillStyle = g; rr(c, x, 62, 54, 84, 10); c.fill();
        c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 2;
        for (let k = 0; k < 6; k++) { c.beginPath(); c.moveTo(x + 6, 70 + k * 13); c.lineTo(x + 48, 70 + k * 13); c.stroke(); }
      }
      // 車身
      let g = c.createLinearGradient(0, 56, 0, 138);
      g.addColorStop(0, shade(col, 0.45)); g.addColorStop(0.45, col); g.addColorStop(1, shade(col, -0.55));
      c.fillStyle = g; c.beginPath();
      c.moveTo(56, 136); c.lineTo(204, 136); c.lineTo(214, 108); c.lineTo(186, 64); c.lineTo(74, 64); c.lineTo(46, 108); c.closePath(); c.fill();
      // 側箱
      c.fillStyle = shade(col, -0.25); c.beginPath(); c.moveTo(46, 108); c.lineTo(74, 70); c.lineTo(90, 70); c.lineTo(70, 116); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(214, 108); c.lineTo(186, 70); c.lineTo(170, 70); c.lineTo(190, 116); c.closePath(); c.fill();
      // 座艙＋安全帽
      g = c.createLinearGradient(0, 40, 0, 80); g.addColorStop(0, '#2b2f3a'); g.addColorStop(1, '#0c0e14');
      c.fillStyle = g; rr(c, 100, 44, 60, 36, 14); c.fill();
      g = c.createRadialGradient(124, 48, 2, 130, 56, 18); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#b9c0cc');
      c.fillStyle = g; c.beginPath(); c.arc(130, 56, 15, 0, TAU); c.fill();
      c.fillStyle = col; c.fillRect(116, 52, 28, 5);
      // 尾翼
      c.fillStyle = '#0d0f14'; c.fillRect(22, 18, 216, 22);
      c.fillStyle = col; c.fillRect(22, 30, 216, 5);
      c.fillStyle = '#05060a'; c.fillRect(18, 10, 12, 64); c.fillRect(230, 10, 12, 64);
      c.fillStyle = '#0d0f14'; c.fillRect(124, 38, 12, 28);
      // 擴散器
      c.fillStyle = '#07080c'; c.beginPath(); c.moveTo(62, 136); c.lineTo(198, 136); c.lineTo(190, 116); c.lineTo(70, 116); c.closePath(); c.fill();
      c.strokeStyle = '#22252e'; c.lineWidth = 2;
      for (let k = 0; k < 7; k++) { const x = 84 + k * 15; c.beginPath(); c.moveTo(x, 118); c.lineTo(x - 2, 136); c.stroke(); }
      // 尾燈
      c.shadowColor = '#ff1a1a'; c.shadowBlur = 16; c.fillStyle = '#ff3030'; c.fillRect(116, 100, 28, 9);
      c.shadowBlur = 0; c.fillStyle = '#ffd0d0'; c.fillRect(122, 102, 16, 4);
      // 排氣管
      c.fillStyle = '#3a3d46'; c.beginPath(); c.arc(130, 92, 6, 0, TAU); c.fill();
      c.fillStyle = '#000'; c.beginPath(); c.arc(130, 92, 3.5, 0, TAU); c.fill();
    });
  }

  /* 以車尾中心底部 (x,y) 為基準畫車；w＝畫面寬度（px） */
  GS.drawCar = function (ctx, x, y, w, o) {
    o = o || {};
    const sp = carSprite(o.color || '#ff2d55'), h = w * 150 / 260, t = o.t || 0;
    // 影子
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.ellipse(x, y - h * 0.02, w * 0.56, h * 0.1, 0, 0, TAU); ctx.fill();
    const bob = o.v ? Math.sin(t * 40 + (o.seed || 0)) * h * 0.006 * Math.min(1, o.v / 40) : 0;
    // 氮氣火焰
    if (o.nitro) {
      const fl = 0.75 + Math.sin(t * 60 + (o.seed || 0)) * 0.25, fx = x, fy = y - h * 0.39 + bob, fl2 = h * (0.55 + fl * 0.45);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      let g = ctx.createRadialGradient(fx, fy + fl2 * 0.25, 1, fx, fy + fl2 * 0.25, fl2 * 0.9);
      g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.25, 'rgba(120,200,255,.85)'); g.addColorStop(0.6, 'rgba(60,90,255,.45)'); g.addColorStop(1, 'rgba(40,40,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(fx, fy + fl2 * 0.35, w * 0.12 * fl, fl2 * 0.65, 0, 0, TAU); ctx.fill();
      g = ctx.createRadialGradient(fx, fy, 1, fx, fy, w * 0.5);
      g.addColorStop(0, 'rgba(120,190,255,.5)'); g.addColorStop(1, 'rgba(120,190,255,0)');
      ctx.fillStyle = g; ctx.fillRect(fx - w * 0.5, fy - w * 0.5, w, w);
      ctx.restore();
    }
    ctx.drawImage(sp, x - w / 2, y - h + bob, w, h);
    // 煞車燈 / 加速光
    if (o.boost && !o.nitro) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, y - h * 0.37, 1, x, y - h * 0.37, w * 0.25);
      g.addColorStop(0, 'rgba(255,220,120,.7)'); g.addColorStop(1, 'rgba(255,160,40,0)');
      ctx.fillStyle = g; ctx.fillRect(x - w * 0.25, y - h * 0.37 - w * 0.25, w * 0.5, w * 0.5); ctx.restore();
    }
    // 打滑 / 熄火 煙
    if (o.smoke) {
      for (let k = 0; k < 8; k++) {
        const side = k % 2 ? 1 : -1, ph = (t * 1.8 + k * 0.137) % 1;
        const sx = x + side * w * (0.4 + ph * 0.25) + Math.sin(k * 3 + t * 3) * w * 0.05, sy = y - h * (0.08 + ph * 0.5), r = w * (0.08 + ph * 0.22);
        ctx.fillStyle = `rgba(200,205,215,${0.4 * (1 - ph)})`; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
      }
    }
  };

  /* 名牌 */
  GS.drawTag = function (ctx, x, y, text, col, size, crown) {
    if (size < 9) return;
    ctx.save();
    ctx.font = `900 ${size}px "Noto Sans TC","Microsoft JhengHei",sans-serif`;
    const tw = ctx.measureText(text).width, pw = tw + size * 1.1, ph = size * 1.55;
    ctx.fillStyle = 'rgba(6,8,16,.82)'; rr(ctx, x - pw / 2, y - ph, pw, ph, ph / 2); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, size * 0.13); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y - ph / 2 + size * 0.05);
    if (crown) { ctx.font = `${size * 1.3}px sans-serif`; ctx.fillText('👑', x, y - ph - size * 0.7); }
    ctx.restore();
  };

  /* 城市天際線（兩層，橫向無縫） */
  function skyline(layer) {
    return sprite('sky' + layer, 2400, 360, (c, W, H) => {
      const far = layer === 0;
      let x = 0, i = layer * 500;
      while (x < W) {
        const bw = (far ? 50 : 70) + hash(i) * (far ? 90 : 120), bh = (far ? 80 : 50) + hash(i + 1) * (far ? 220 : 190);
        const top = H - bh;
        c.fillStyle = far ? '#1a1238' : '#0c0a1e'; c.fillRect(x, top, bw - 4, bh);
        if (!far && hash(i + 9) > 0.6) { c.fillRect(x + bw * 0.4, top - 30, 4, 30); c.fillStyle = '#ff2d55'; c.fillRect(x + bw * 0.4 - 2, top - 34, 8, 6); c.fillStyle = '#0c0a1e'; }
        // 窗戶
        const wc = far ? 'rgba(160,120,255,' : 'rgba(255,200,120,';
        for (let wy = top + 10; wy < H - 8; wy += far ? 12 : 16) {
          for (let wx = x + 6; wx < x + bw - 12; wx += far ? 10 : 14) {
            const hh = hash(wx * 0.37 + wy * 1.91 + layer);
            if (hh > (far ? 0.72 : 0.8)) { c.fillStyle = wc + (0.25 + hash(hh * 99) * 0.5) + ')'; c.fillRect(wx, wy, far ? 4 : 6, far ? 5 : 7); }
          }
        }
        // 霓虹招牌
        if (!far && hash(i + 4) > 0.72) {
          const nc = ['#ff2d55', '#19e3ff', '#ffc21a', '#b44dff'][Math.floor(hash(i + 5) * 4)];
          c.save(); c.shadowColor = nc; c.shadowBlur = 14; c.fillStyle = nc;
          c.fillRect(x + 8, top + 20 + hash(i + 6) * 40, 6, 40 + hash(i + 7) * 40); c.restore();
        }
        x += bw; i++;
      }
    });
  }

  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  const C = s => `rgb(${s[0] | 0},${s[1] | 0},${s[2] | 0})`;
  const FOG = [26, 14, 46];
  const PAL = {
    grass: [[9, 11, 22], [20, 22, 44]], road: [[38, 40, 52], [43, 45, 58]],
    rumble: [[230, 30, 60], [235, 235, 240]], lane: [235, 235, 240]
  };

  /* ───────── 偽 3D 道路主繪圖 ─────────
     o = { tr, camD(相機所在距離), camX(公尺), camH, horizon(0~1), fov, drawN, t, bgOff,
           cars:[{d,x,color,name,nitro,boost,smoke,lead,me,v,seed}], brand, logoImg, speedFx(0~1), labels } */
  GS.drawRoad = function (ctx, W, H, o) {
    const tr = o.tr, SEG = GS.SEG, RW = GS.ROADW, N = o.drawN || 180;
    const HZ = H * (o.horizon || 0.42), DEPTH = 1 / Math.tan((o.fov || 90) * Math.PI / 360), HW = W / 2;
    const camZ = o.camD, camY = GS.hillAt(camZ) + (o.camH || 4), camX = o.camX || 0, t = o.t || 0;

    // 天空（漸層＋地平線光暈＋暗角都預先畫好快取，每格只貼圖）
    const skyBg = sprite('skybg' + W + 'x' + Math.round(HZ), W, Math.ceil(HZ) + 2, (c) => {
      const g = c.createLinearGradient(0, 0, 0, HZ);
      g.addColorStop(0, '#05030f'); g.addColorStop(0.55, '#1c0b3a'); g.addColorStop(0.85, '#4a1250'); g.addColorStop(1, '#8a1f55');
      c.fillStyle = g; c.fillRect(0, 0, W, HZ + 2);
      const g2 = c.createRadialGradient(W * 0.5, HZ, 10, W * 0.5, HZ, W * 0.6);
      g2.addColorStop(0, 'rgba(255,60,120,.45)'); g2.addColorStop(1, 'rgba(255,60,120,0)');
      c.fillStyle = g2; c.fillRect(0, HZ - W * 0.3, W, W * 0.3);
    });
    ctx.drawImage(skyBg, 0, 0);
    let g;
    for (let i = 0; i < 90; i++) {
      const x = hash(i) * W, y = hash(i + 50) * HZ * 0.6, b = hash(i + 7);
      ctx.globalAlpha = (0.3 + 0.6 * b) * (0.6 + 0.4 * Math.sin(t * (1 + b * 2) + i)); ctx.fillStyle = '#fff';
      ctx.fillRect(x, y, b > 0.9 ? 2 : 1.2, b > 0.9 ? 2 : 1.2);
    }
    ctx.globalAlpha = 1;
    // 天際線
    const sk = W / 1600;
    for (let L = 0; L < 2; L++) {
      const img = skyline(L), sw = 2400 * sk * (L ? 1.15 : 0.9), sh = 360 * sk * (L ? 1.15 : 0.9);
      const off = (((o.bgOff || 0) * (L ? 1 : 0.5)) % sw + sw) % sw;
      for (let x = -off; x < W; x += sw) ctx.drawImage(img, x, HZ - sh + 2, sw, sh);
    }
    ctx.fillStyle = C(FOG); ctx.fillRect(0, HZ, W, H - HZ);

    // 投影各段
    const base = Math.floor(camZ / SEG), pct = (camZ - base * SEG) / SEG;
    const P = new Array(N + 1);
    let x = 0, dx = -GS.curveAt(tr, base * SEG) * GS.CURV * pct;
    for (let n = 0; n <= N; n++) {
      const z = (base + n) * SEG;
      const cz = z - camZ;
      const wy = GS.hillAt(z);
      if (cz > 0.4) {
        const s = DEPTH / cz;
        P[n] = { z, wx: x, s, sx: HW + s * (x - camX) * HW, sy: HZ - s * (wy - camY) * HW, w: s * RW * HW };
      } else P[n] = { z, wx: x, s: 0, sy: Infinity };
      x += dx; dx += GS.curveAt(tr, z) * GS.CURV;
    }
    // 依段分配車輛
    const carsAt = {};
    (o.cars || []).forEach(car => {
      const n = Math.floor(car.d / SEG) - base; if (n < 1 || n >= N) return;
      (carsAt[n] = carsAt[n] || []).push(car);
    });
    const lapZ = []; for (let k = 0; k <= tr.laps; k++) lapZ.push(k * tr.L);

    const proj = (n, z, lat, hgt) => {
      const a = P[n], b = P[n + 1] || a, f = (z - a.z) / SEG;
      const wx = a.wx + (b.wx - a.wx) * f, wy = GS.hillAt(z) + (hgt || 0), cz = z - camZ;
      if (cz <= 0.5) return null;
      const s = DEPTH / cz;
      return { x: HW + s * (wx + lat - camX) * HW, y: HZ - s * (wy - camY) * HW, s: s * HW };
    };

    for (let n = N - 1; n >= 1; n--) {
      const a = P[n], b = P[n + 1];
      if (!a.s || !b.s) continue;
      const fog = Math.min(1, Math.pow(n / N, 1.6));
      const idx = base + n, alt = ((Math.floor(idx / 3) % 2) + 2) % 2;
      if (b.sy < a.sy) {
        ctx.fillStyle = C(mix(PAL.grass[alt], FOG, fog)); ctx.fillRect(0, b.sy, W, a.sy - b.sy + 1);
        const quad = (k1, k2, col) => {
          ctx.fillStyle = col; ctx.beginPath();
          ctx.moveTo(a.sx + a.w * k1, a.sy); ctx.lineTo(a.sx + a.w * k2, a.sy);
          ctx.lineTo(b.sx + b.w * k2, b.sy); ctx.lineTo(b.sx + b.w * k1, b.sy); ctx.closePath(); ctx.fill();
        };
        const rum = C(mix(PAL.rumble[alt], FOG, fog));
        quad(-1.14, -1, rum); quad(1, 1.14, rum);
        quad(-1, 1, C(mix(PAL.road[alt], FOG, fog)));
        if (alt) { const lc = C(mix(PAL.lane, FOG, fog)); quad(-0.35, -0.32, lc); quad(0.32, 0.35, lc); }
        // 霓虹邊線
        const nc = `rgba(25,227,255,${0.85 * (1 - fog)})`;
        quad(-1.2, -1.16, nc); quad(1.16, 1.2, nc);
        // 起終點格子
        for (const lz of lapZ) {
          if (lz >= a.z && lz < a.z + SEG) {
            const cells = 12;
            for (let r = 0; r < 2; r++) for (let k = 0; k < cells; k++) {
              if ((k + r) % 2) continue;
              const k1 = -1 + 2 * k / cells, k2 = k1 + 2 / cells, ya = a.sy + (b.sy - a.sy) * r / 2, yb = a.sy + (b.sy - a.sy) * (r + 1) / 2;
              const xa = a.sx + (b.sx - a.sx) * r / 2, xb = a.sx + (b.sx - a.sx) * (r + 1) / 2, wa = a.w + (b.w - a.w) * r / 2, wb = a.w + (b.w - a.w) * (r + 1) / 2;
              ctx.fillStyle = C(mix([240, 240, 240], FOG, fog)); ctx.beginPath();
              ctx.moveTo(xa + wa * k1, ya); ctx.lineTo(xa + wa * k2, ya); ctx.lineTo(xb + wb * k2, yb); ctx.lineTo(xb + wb * k1, yb); ctx.closePath(); ctx.fill();
            }
          }
        }
      }
      // 路邊物件
      const z0 = a.z;
      if (idx % 12 === 0) for (const side of [-1, 1]) GS.drawLamp(ctx, proj(n, z0, side * RW * 1.45, 0), fog, side);
      if (idx % 70 === 35) { const side = (Math.floor(idx / 70) % 2) ? 1 : -1; GS.drawBoard(ctx, proj(n, z0, side * RW * 2.1, 0), fog, o, idx); }
      if (idx % 5 === 0) {
        for (const c of tr.curves) {
          if (z0 >= c.s - 50 && z0 <= c.s + c.len) GS.drawChevron(ctx, proj(n, z0, -c.dir * RW * 1.42, 0), fog, c.dir, t);
          if (c.s > z0 + 60) break;
        }
      }
      for (let k = 0; k < lapZ.length; k++) {
        const lz = lapZ[k];
        if (lz >= z0 && lz < z0 + SEG) {
          const lab = k === 0 ? 'START' : k === tr.laps ? 'FINISH' : (k === tr.laps - 1 ? 'FINAL LAP' : 'LAP ' + (k + 1));
          GS.drawGantry(ctx, proj(n, lz, -RW * 1.3, 0), proj(n, lz, RW * 1.3, 0), fog, lab, o.brand);
        }
      }
      const cs = carsAt[n];
      if (cs) {
        cs.sort((p, q) => q.d - p.d);
        for (const car of cs) {
          const p = proj(n, car.d, (car.x || 0) * RW, 0); if (!p) continue;
          const cw = p.s * 2.1;
          if (cw < 2) continue;
          GS.drawCar(ctx, p.x, p.y, cw, { color: car.color, nitro: car.nitro, boost: car.boost, smoke: car.smoke, t, v: car.v, seed: car.seed });
          if (o.labels !== false && car.name) GS.drawTag(ctx, p.x, p.y - cw * 0.62, car.name, car.color, Math.min(34, Math.max(car.lead ? 18 : 0, cw * 0.11)), car.lead);
        }
      }
    }
    // 速度線
    const sf = o.speedFx || 0;
    if (sf > 0.05) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 40; i++) {
        const ang = hash(i) * TAU, ph = (t * (1.2 + hash(i + 3)) * (0.6 + sf * 1.6) + hash(i + 9)) % 1;
        const r0 = W * (0.25 + ph * 0.6), r1 = r0 + W * (0.05 + sf * 0.12);
        const cx = W / 2, cy = HZ + H * 0.05;
        ctx.strokeStyle = `rgba(200,230,255,${0.22 * sf * ph})`; ctx.lineWidth = 1 + sf * 2;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0 * 0.6); ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1 * 0.6); ctx.stroke();
      }
      ctx.restore();
    }
    // 暗角（快取）
    ctx.drawImage(sprite('vig' + W + 'x' + H, W, H, (c) => {
      const g2 = c.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.3, W / 2, H * 0.55, Math.max(W, H) * 0.75);
      g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,.55)');
      c.fillStyle = g2; c.fillRect(0, 0, W, H);
    }), 0, 0);
  };

  GS.drawLamp = function (ctx, p, fog, side) {
    if (!p || p.s < 0.6) return;
    const h = p.s * 7, w = Math.max(1, p.s * 0.22);
    ctx.fillStyle = `rgba(60,64,80,${1 - fog})`; ctx.fillRect(p.x - w / 2, p.y - h, w, h);
    ctx.fillRect(p.x, p.y - h, -side * p.s * 1.4, w);
    const lx = p.x - side * p.s * 1.4, ly = p.y - h;
    const r = p.s * 2.6;
    const glow = sprite('lampglow', 128, 128, (c) => {
      const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,240,200,.9)'); g.addColorStop(0.2, 'rgba(255,180,90,.35)'); g.addColorStop(1, 'rgba(255,140,60,0)');
      c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    });
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - fog;
    ctx.drawImage(glow, lx - r, ly - r, r * 2, r * 2); ctx.restore();
  };

  GS.drawChevron = function (ctx, p, fog, dir, t) {
    if (!p || p.s < 0.5) return;
    const w = p.s * 1.7, h = p.s * 1.1, x = p.x - w / 2, y = p.y - h - p.s * 0.6;
    ctx.fillStyle = `rgba(20,20,26,${1 - fog})`; ctx.fillRect(p.x - p.s * 0.08, p.y - p.s * 0.6, p.s * 0.16, p.s * 0.6);
    ctx.fillStyle = `rgba(255,${190 + 40 * Math.sin(t * 8) | 0},20,${1 - fog})`; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = `rgba(10,10,10,${1 - fog})`;
    for (let k = 0; k < 2; k++) {
      const cx = x + w * (0.3 + k * 0.4);
      ctx.beginPath();
      ctx.moveTo(cx - dir * w * 0.14, y + h * 0.15); ctx.lineTo(cx + dir * w * 0.1, y + h * 0.5); ctx.lineTo(cx - dir * w * 0.14, y + h * 0.85);
      ctx.lineTo(cx - dir * w * 0.02, y + h * 0.85); ctx.lineTo(cx + dir * w * 0.22, y + h * 0.5); ctx.lineTo(cx - dir * w * 0.02, y + h * 0.15); ctx.closePath(); ctx.fill();
    }
  };

  GS.drawBoard = function (ctx, p, fog, o, idx) {
    if (!p || p.s < 0.25) return;
    const w = p.s * 9, h = p.s * 3.4, x = p.x - w / 2, y = p.y - h - p.s * 2.4;
    const a = 1 - fog;
    ctx.fillStyle = `rgba(40,42,54,${a})`; ctx.fillRect(p.x - w * 0.35, y + h, p.s * 0.25, p.s * 2.4); ctx.fillRect(p.x + w * 0.35, y + h, p.s * 0.25, p.s * 2.4);
    const ci = Math.floor(hash(idx) * 4), nc = ['#ff2d55', '#19e3ff', '#ffc21a', '#b44dff'][ci];
    const img = o.logoImg, useLogo = !!(img && img.complete && img.naturalWidth && hash(idx + 1) > 0.35);
    // 看板整面預先畫成貼圖（含霓虹光暈），每格只縮放貼上
    const key = 'board' + ci + '|' + (useLogo ? 'L' + (img.src.length + ':' + img.src.slice(-24)) : 'T' + (o.brand || ''));
    const bw = 360, bh = 136, pad = 14;
    const spr = sprite(key, bw + pad * 2, bh + pad * 2, (c) => {
      c.fillStyle = '#0a0b12'; c.fillRect(pad, pad, bw, bh);
      c.shadowColor = nc; c.shadowBlur = 14; c.strokeStyle = nc; c.lineWidth = 6; c.strokeRect(pad, pad, bw, bh); c.shadowBlur = 0;
      if (useLogo) {
        const k = Math.min((bw * 0.86) / img.naturalWidth, (bh * 0.8) / img.naturalHeight);
        c.drawImage(img, pad + bw / 2 - img.naturalWidth * k / 2, pad + bh / 2 - img.naturalHeight * k / 2, img.naturalWidth * k, img.naturalHeight * k);
      } else {
        c.fillStyle = nc; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.font = `italic 900 ${bh * 0.42}px "Orbitron","Noto Sans TC",sans-serif`;
        c.shadowColor = nc; c.shadowBlur = 10;
        c.fillText(o.brand || 'FULL SPRINT', pad + bw / 2, pad + bh / 2, bw * 0.9);
      }
    });
    const k2 = w / bw;
    ctx.save(); ctx.globalAlpha = a;
    ctx.drawImage(spr, x - pad * k2, y - pad * k2, (bw + pad * 2) * k2, (bh + pad * 2) * k2);
    ctx.restore();
  };

  GS.drawGantry = function (ctx, l, r, fog, label, brand) {
    if (!l || !r || l.s < 0.3) return;
    const a = 1 - fog, ph = l.s * 7.5, bh = l.s * 1.6;
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = '#1b1d26'; ctx.fillRect(l.x - l.s * 0.3, l.y - ph, l.s * 0.6, ph); ctx.fillRect(r.x - r.s * 0.3, r.y - ph, r.s * 0.6, ph);
    const y = l.y - ph;
    ctx.fillStyle = '#0b0c12'; ctx.fillRect(l.x, y, r.x - l.x, bh);
    // 格子條
    const cell = bh / 3, cols = Math.ceil((r.x - l.x) / cell);
    for (let k = 0; k < cols; k++) for (let j = 0; j < 1; j++) { if (k % 2) continue; ctx.fillStyle = '#e8e8e8'; ctx.fillRect(l.x + k * cell, y + bh - cell, Math.min(cell, r.x - l.x - k * cell), cell); }
    for (let k = 0; k < cols; k++) { if (!(k % 2)) continue; ctx.fillStyle = '#e8e8e8'; ctx.fillRect(l.x + k * cell, y, Math.min(cell, r.x - l.x - k * cell), cell); }
    ctx.fillStyle = '#ffd60a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `italic 900 ${cell * 1.0}px "Orbitron",sans-serif`;
    ctx.fillText(label, (l.x + r.x) / 2, y + bh / 2, (r.x - l.x) * 0.9);
    ctx.restore();
  };

  /* ───────── 轉速表（手機） ───────── */
  GS.drawTacho = function (ctx, W, H, o) {
    const cx = W / 2, cy = H * 0.62, R = Math.min(W * 0.4, H * 0.56), A0 = Math.PI * 0.8, A1 = Math.PI * 2.2;
    const ang = r => A0 + (A1 - A0) * r;
    ctx.clearRect(0, 0, W, H);
    // 底盤
    let g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.12);
    g.addColorStop(0, '#171a26'); g.addColorStop(1, '#07080d');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.1, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 2; ctx.stroke();
    const lw = R * 0.13;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#262a38'; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(cx, cy, R * 0.92, ang(0), ang(1)); ctx.stroke();
    if (o.zone) {
      ctx.save(); ctx.shadowColor = '#2dff8a'; ctx.shadowBlur = o.inZone ? 24 : 8;
      ctx.strokeStyle = o.inZone ? '#5dffa6' : '#1fd172'; ctx.beginPath(); ctx.arc(cx, cy, R * 0.92, ang(o.zone[0]), ang(o.zone[1])); ctx.stroke(); ctx.restore();
      ctx.strokeStyle = '#ff2d55'; ctx.beginPath(); ctx.arc(cx, cy, R * 0.92, ang(GS.RED), ang(1)); ctx.stroke();
    }
    // 刻度
    ctx.fillStyle = '#9aa3bd'; ctx.font = `700 ${R * 0.12}px "Orbitron",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let k = 0; k <= 10; k++) {
      const a = ang(k / 10), r1 = R * 0.78, r2 = R * (k % 2 ? 0.74 : 0.7);
      ctx.strokeStyle = k >= 9 ? '#ff2d55' : '#9aa3bd'; ctx.lineWidth = k % 2 ? 1.5 : 3;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
      if (!(k % 2)) ctx.fillText(k, cx + Math.cos(a) * R * 0.6, cy + Math.sin(a) * R * 0.6);
    }
    // 指針
    const a = ang(Math.min(1.02, o.rpm || 0));
    ctx.save(); ctx.shadowColor = '#ff5a1f'; ctx.shadowBlur = 12; ctx.strokeStyle = '#ff6a2a'; ctx.lineWidth = R * 0.05; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * R * 0.12, cy - Math.sin(a) * R * 0.12); ctx.lineTo(cx + Math.cos(a) * R * 0.88, cy + Math.sin(a) * R * 0.88); ctx.stroke(); ctx.restore();
    ctx.fillStyle = '#0c0e16'; ctx.beginPath(); ctx.arc(cx, cy, R * 0.3, 0, TAU); ctx.fill();
    ctx.strokeStyle = o.stall ? '#ff2d55' : 'rgba(255,255,255,.15)'; ctx.lineWidth = 2; ctx.stroke();
    // 檔位、速度
    ctx.fillStyle = o.stall ? '#ff2d55' : '#fff'; ctx.font = `italic 900 ${R * 0.34}px "Orbitron",sans-serif`;
    ctx.fillText(o.stall ? '!' : (o.gear || 1), cx, cy - R * 0.02);
    ctx.fillStyle = '#ffd60a'; ctx.font = `italic 900 ${R * 0.2}px "Orbitron",sans-serif`;
    ctx.fillText(Math.round((o.v || 0) * 3.6), cx, cy + R * 0.48);
    ctx.fillStyle = '#7d86a3'; ctx.font = `700 ${R * 0.085}px "Orbitron",sans-serif`; ctx.fillText('KM/H', cx, cy + R * 0.65);
    // 換檔燈
    const n = 10, lw2 = W * 0.06, gap = W * 0.012, tot = n * lw2 + (n - 1) * gap, y0 = H * 0.05;
    for (let k = 0; k < n; k++) {
      const th = (k + 1) / n, on = (o.rpm || 0) >= th * 0.9, x0 = cx - tot / 2 + k * (lw2 + gap);
      let col = k < 4 ? '#2dff8a' : k < 7 ? '#ffd60a' : '#ff2d55';
      if (o.inZone && o.flash) col = '#3aa8ff';
      ctx.fillStyle = on ? col : '#1c1f2b';
      if (on) { ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 10; }
      rr(ctx, x0, y0, lw2, H * 0.06, 4); ctx.fill();
      if (on) ctx.restore();
    }
  };
})();
