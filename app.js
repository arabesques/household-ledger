/* =========================================================
   家用收支簿 — 前端程式
   ・純前端單頁網站（hash 路由），可直接放在 GitHub Pages
   ・正式模式：家庭密碼 → Apps Script API → Google Sheet
   ・示範模式：config.js 未填時啟用，資料存在瀏覽器 localStorage
   ========================================================= */
(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const DEMO = !CFG.API_URL;

  const DEFAULT_PAYERS = ['牧', '虎'];
  const DEFAULT_CATEGORIES = ['餐飲食材', 'Sunny', '日常用品', '住宅開銷', '家電傢俱', '其他'];
  const CATEGORY_STYLE = {
    '餐飲食材': { icon: 'food', color: '#4B2717' },
    'Sunny': { icon: 'paw', color: '#D08A06' },
    '日常用品': { icon: 'bag', color: '#6D731C' },
    '住宅開銷': { icon: 'house', color: '#906A4B' },
    '家電傢俱': { icon: 'tv', color: '#7B4B2A' },
    '其他': { icon: 'tag', color: '#B39478' }
  };
  const FALLBACK_CAT_COLORS = ['#8A6A3E', '#5F6A3A', '#A37A55', '#6B4A33'];
  const MAX_AMOUNT = 999999;
  const MAX_NAME = 50;
  const LS = { lastPayer: 'hl_last_payer', pass: 'hl_passcode', me: 'hl_me', demo: 'hl_demo_v1' };

  /* ---------------------------------------------------------
     小工具
     --------------------------------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('zh-TW');
  const pad = (n) => String(n).padStart(2, '0');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* 無痕模式等情況忽略 */ } }
  function lsDel(key) { try { localStorage.removeItem(key); } catch (e) { /* 忽略 */ } }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const monthOf = (date) => String(date).slice(0, 7);
  const currentMonth = () => monthOf(todayStr());
  function addMonths(ym, n) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  function monthLabel(ym) { const [y, m] = ym.split('-'); return `${y} 年 ${Number(m)} 月`; }
  function shortMonth(ym) { return `${Number(ym.split('-')[1])} 月`; }
  function mdLabel(date) { const [, m, d] = date.split('-'); return `${Number(m)}/${d}`; }
  function weekday(date) {
    const [y, m, d] = date.split('-').map(Number);
    return '日一二三四五六'[new Date(y, m - 1, d).getDay()];
  }
  function isValidDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }
  function isValidMonth(s) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(s); }
  function settledDateLabel(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return String(iso).slice(5, 10).replace('-', '/');
    return `${d.getMonth() + 1}/${pad(d.getDate())}`;
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  /* ---------------------------------------------------------
     圖示（線條 SVG）
     --------------------------------------------------------- */
  const ICONS = {
    house: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9"/><path d="M9.5 20v-6h5v6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    food: '<path d="M5 11a7 7 0 0 1 14 0v2a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3Z"/><path d="M3 20h18"/>',
    paw: '<circle cx="8" cy="7" r="1.6"/><circle cx="16" cy="7" r="1.6"/><circle cx="5" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/><path d="M12 21c-3 0-5-1.8-5-4.3 0-2 1.6-3 2.4-4.6.6-1.2.9-2.1 2.6-2.1s2 .9 2.6 2.1c.8 1.6 2.4 2.6 2.4 4.6 0 2.5-2 4.3-5 4.3Z"/>',
    bag: '<path d="M4 9h16l-1.4 10.2a1.8 1.8 0 0 1-1.8 1.5H7.2a1.8 1.8 0 0 1-1.8-1.5Z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/>',
    tv: '<rect x="4" y="3" width="16" height="12" rx="2"/><path d="M8 19h8M12 15v4"/>',
    tag: '<path d="M20.6 12.4 12.4 20.6a1.7 1.7 0 0 1-2.4 0l-6.6-6.6a1.7 1.7 0 0 1 0-2.4L11.6 3.4A2 2 0 0 1 13 2.8L19 3a1 1 0 0 1 1 1l.2 6a2 2 0 0 1-.6 1.4Z"/><circle cx="15" cy="8" r="1.4"/>',
    pie: '<path d="M12 3v9l7 4"/><circle cx="12" cy="12" r="9"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    chevL: '<path d="m15 18-6-6 6-6"/>',
    chevR: '<path d="m9 18 6-6-6-6"/>',
    alert: '<path d="M12 9v4"/><path d="M10.3 3.9 2.6 18a1.6 1.6 0 0 0 1.4 2.4h16a1.6 1.6 0 0 0 1.4-2.4L13.7 3.9a1.6 1.6 0 0 0-2.8 0Z"/><path d="M12 17h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
    xCircle: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.7"/>',
    refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M20.5 3.5V8H16"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4.5l3 2"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="m10 17 5-5-5-5M15 12H3"/>',
    inbox: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z"/>',
    beaker: '<path d="M9 3h6M10 3v6L4.6 18.6A1.6 1.6 0 0 0 6 21h12a1.6 1.6 0 0 0 1.4-2.4L14 9V3"/><path d="M7.5 15h9"/>',
    pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>',
    wallet: '<path d="M4 7a2 2 0 0 1 2-2h12v4"/><path d="M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2Z"/><path d="M16 14.5h.01"/>'
  };
  const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.tag}</svg>`;
  const catIcon = (cat) => (CATEGORY_STYLE[cat] || {}).icon || 'tag';
  const catColor = (cat, i = 0) => (CATEGORY_STYLE[cat] || {}).color || FALLBACK_CAT_COLORS[i % FALLBACK_CAT_COLORS.length];

  /* ---------------------------------------------------------
     狀態與計算
     --------------------------------------------------------- */
  const state = {
    loaded: false,
    entries: [],
    settlements: {},
    payers: DEFAULT_PAYERS.slice(),
    categories: DEFAULT_CATEGORIES.slice(),
    user: null,
    bootError: null
  };

  const byNewest = (a, b) =>
    (b.date > a.date ? 1 : b.date < a.date ? -1 : 0) ||
    String(b.createdAt || '').localeCompare(String(a.createdAt || ''));

  function entriesOf(ym) { return state.entries.filter((e) => monthOf(e.date) === ym).sort(byNewest); }

  /** 依 PRD：每人應分攤 = 總額 ÷ 2（四捨五入），差額 = 已付 − 應分攤 */
  function summarize(entries, payers) {
    const paid = {};
    payers.forEach((p) => { paid[p] = 0; });
    let total = 0;
    entries.forEach((e) => {
      total += e.amount;
      paid[e.payer] = (paid[e.payer] || 0) + e.amount;
    });
    const n = Math.max(payers.length, 1);
    const share = Math.round(total / n);
    let transfer = null;
    if (payers.length === 2 && total > 0) {
      const [a, b] = payers;
      if (paid[a] !== paid[b]) {
        const debtor = paid[a] < paid[b] ? a : b;
        const creditor = debtor === a ? b : a;
        transfer = { from: debtor, to: creditor, amount: share - paid[debtor] };
      }
    }
    return { total, paid, share, transfer, count: entries.length };
  }
  const summary = (ym) => summarize(entriesOf(ym), state.payers);

  function resultText(sum) {
    if (!sum.total) return '本月無支出';
    if (!sum.transfer || sum.transfer.amount === 0) return '兩人已付相同，無需補付';
    return `${sum.transfer.from}→${sum.transfer.to} ${fmt(sum.transfer.amount)}`;
  }

  const settlementOf = (ym) => {
    const s = state.settlements[ym];
    return s && s.status === '已結算' ? s : null;
  };
  const isSettled = (ym) => !!settlementOf(ym);

  /* ---------------------------------------------------------
     資料驗證（前端與示範模式共用；正式模式伺服器會再驗一次）
     --------------------------------------------------------- */
  function validateEntry(e) {
    const errors = {};
    if (!e.date || !isValidDate(e.date)) errors.date = '請選擇日期';
    else if (isSettled(monthOf(e.date))) errors.date = `${monthLabel(monthOf(e.date))}已結算，無法記在這個月份；需要時請先取消結算`;
    if (!state.payers.includes(e.payer)) errors.payer = '請選擇誰付錢';
    if (!state.categories.includes(e.category)) errors.category = '請選擇分類';
    const name = String(e.name || '').trim();
    if (!name) errors.name = '請輸入名稱';
    else if ([...name].length > MAX_NAME) errors.name = `名稱最多 ${MAX_NAME} 字`;
    if (e.amount === null || e.amount === undefined || e.amount === '') errors.amount = '請輸入金額';
    else if (!Number.isInteger(e.amount) || e.amount < 1 || e.amount > MAX_AMOUNT) errors.amount = `金額需為 1 到 ${fmt(MAX_AMOUNT)} 的整數`;
    return errors;
  }

  /* ---------------------------------------------------------
     API：正式模式（Apps Script）/ 示範模式（localStorage）
     --------------------------------------------------------- */
  class ApiError extends Error {
    constructor(code, message) { super(message || code); this.code = code; }
  }
  const ERROR_TEXT = {
    network: '連線失敗，請檢查網路後再試一次',
    bad_response: '伺服器回應異常，請確認 Apps Script 網址與部署設定',
    unauthorized: '密碼不正確，請重新輸入',
    too_many: '密碼錯誤次數過多，請 10 分鐘後再試',
    locked: '該月份已結算，請先取消結算再修改',
    not_found: '找不到這筆明細，可能已在 Google Sheet 刪除，請重新整理',
    already_settled: '這個月份已經結算過了，請重新整理',
    not_settled: '這個月份目前不是已結算狀態，請重新整理',
    empty_month: '這個月份沒有支出，無需結算',
    busy: '系統忙碌中，請稍後再試',
    not_configured: 'Apps Script 尚未完成設定，請依 README 設定指令碼屬性',
    server_error: '伺服器發生錯誤，請稍後再試'
  };
  function errorMessage(err) {
    if (err && err.code === 'invalid' && err.message && err.message !== 'invalid') return err.message;
    return (err && ERROR_TEXT[err.code]) || (err && err.message) || ERROR_TEXT.server_error;
  }

  /* ---- 正式模式：家庭密碼 ---- */
  const Pass = {
    code: '', me: '',
    restore() { this.code = lsGet(LS.pass) || ''; this.me = lsGet(LS.me) || ''; },
    save(code, me) { this.code = code; this.me = me; lsSet(LS.pass, code); lsSet(LS.me, me); },
    setMe(me) { this.me = me; lsSet(LS.me, me); },
    clear() { this.code = ''; lsDel(LS.pass); }
  };

  async function remoteCall(action, payload = {}) {
    if (!Pass.code) throw new ApiError('unauthorized');
    let res;
    try {
      res = await fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // 避免 CORS 預檢
        body: JSON.stringify(Object.assign({ action, passcode: Pass.code, operator: Pass.me }, payload)),
        redirect: 'follow'
      });
    } catch (e) { throw new ApiError('network'); }
    let data;
    try { data = await res.json(); } catch (e) { throw new ApiError('bad_response'); }
    if (!data || !data.ok) {
      const code = (data && data.error) || 'server_error';
      if (code === 'unauthorized' && state.loaded) {
        // 使用中密碼被更換：回到輸入密碼畫面
        Pass.clear();
        closeDialog();
        state.loaded = false;
        state.bootError = { kind: 'login', message: '密碼已變更，請輸入新的密碼' };
        render();
      }
      throw new ApiError(code, data && data.message);
    }
    return data;
  }

  /* ---- 示範模式 ---- */
  const Demo = {
    db: null,
    load() {
      try { this.db = JSON.parse(lsGet(LS.demo) || 'null'); } catch (e) { this.db = null; }
      if (!this.db || !Array.isArray(this.db.entries)) { this.db = this.seed(); this.save(); }
    },
    save() { lsSet(LS.demo, JSON.stringify(this.db)); },
    reset() { this.db = this.seed(); this.save(); },
    seed() {
      const now = new Date();
      const cur = currentMonth();
      const today = now.getDate();
      const entries = [];
      const settlements = {};
      const add = (ym, day, payer, category, name, amount) => {
        const [y, m] = ym.split('-').map(Number);
        const last = new Date(y, m, 0).getDate();
        let d = Math.min(day, last);
        if (ym === cur) d = Math.min(d, today);
        const date = `${ym}-${pad(d)}`;
        const ts = new Date(y, m - 1, d, 20, 0).toISOString();
        entries.push({ id: uuid(), date, payer, category, name, amount, createdAt: ts, updatedAt: ts });
      };
      // 本月：沿用 PRD 範例（總額 20,000；牧 13,000、虎 7,000）
      [[2, '牧', '住宅開銷', '管理費', 3200], [4, '虎', 'Sunny', '飼料', 1680], [7, '牧', '餐飲食材', '全聯採買', 2480],
        [9, '虎', '餐飲食材', '家樂福', 2350], [12, '虎', '日常用品', '衛生紙', 590], [15, '牧', '餐飲食材', '好市多', 4320],
        [18, '虎', '日常用品', '洗衣精', 380], [21, '牧', '住宅開銷', '電費', 1850], [23, '虎', '住宅開銷', '水費', 620],
        [25, '牧', 'Sunny', '寵物美容', 1150], [27, '虎', '餐飲食材', '晚餐外帶', 1380]
      ].forEach(([d, p, c, n, a]) => add(cur, d, p, c, n, a));

      const template = [
        [2, '牧', '住宅開銷', '管理費', 3200], [3, '虎', 'Sunny', '飼料', 1600], [6, '牧', '餐飲食材', '全聯採買', 2300],
        [8, '虎', '餐飲食材', '傳統市場', 1450], [10, '虎', '日常用品', '衛生紙', 560], [13, '牧', '餐飲食材', '好市多', 3900],
        [16, '虎', 'Sunny', '獸醫門診', 1800], [19, '牧', '住宅開銷', '網路費', 999], [22, '虎', '日常用品', '洗碗精', 260],
        [24, '牧', '住宅開銷', '電費', 1700], [26, '虎', '餐飲食材', '家樂福', 2100], [28, '牧', '其他', '停車費', 600]
      ];
      const extras = { 2: [11, '牧', '家電傢俱', '除濕機', 6990], 3: [17, '虎', '家電傢俱', '電風扇', 1890] };
      [1, 2, 3, 4].forEach((back) => {
        const ym = addMonths(cur, -back);
        const factor = [1, 0.94, 1.08, 0.97, 1.03][back];
        template.forEach(([d, p, c, n, a], i) => {
          const tweak = 1 + (((i * 7 + back * 3) % 9) - 4) / 50;
          add(ym, d, p, c, n, Math.max(50, Math.round((a * factor * tweak) / 10) * 10));
        });
        if (extras[back]) add(ym, ...extras[back]);
        if (back >= 2) {
          const sum = summarize(entries.filter((e) => monthOf(e.date) === ym), DEFAULT_PAYERS);
          const settleDay = addMonths(ym, 1) + '-02';
          settlements[ym] = {
            month: ym, status: '已結算', total: sum.total, result: resultText(sum),
            settledAt: new Date(settleDay + 'T21:30:00').toISOString(), operator: back % 2 ? '虎' : '牧'
          };
        }
      });
      return { entries, settlements };
    },

    async call(action, p = {}) {
      await sleep(220);
      const db = this.db;
      const locked = (ym) => db.settlements[ym] && db.settlements[ym].status === '已結算';
      const clean = (e) => ({ date: e.date, payer: e.payer, category: e.category, name: String(e.name || '').trim(), amount: e.amount });
      const check = (e) => {
        if (isValidDate(e.date) && locked(monthOf(e.date))) throw new ApiError('locked');
        const errs = validateEntry(e);
        const first = Object.keys(errs)[0];
        if (first) throw new ApiError('invalid', errs[first]);
      };
      let out;
      switch (action) {
        case 'list':
          out = { entries: db.entries, settlements: db.settlements, payers: DEFAULT_PAYERS, categories: DEFAULT_CATEGORIES, user: { name: lsGet(LS.lastPayer) || DEFAULT_PAYERS[0], email: '' } };
          break;
        case 'create': {
          const e = clean(p.entry); check(e);
          const ts = new Date().toISOString();
          const entry = Object.assign({ id: uuid(), createdAt: ts, updatedAt: ts }, e);
          db.entries.push(entry); out = { entry };
          break;
        }
        case 'update': {
          const old = db.entries.find((x) => x.id === p.entry.id);
          if (!old) throw new ApiError('not_found');
          if (locked(monthOf(old.date))) throw new ApiError('locked');
          const e = clean(p.entry); check(e);
          Object.assign(old, e, { updatedAt: new Date().toISOString() }); out = { entry: old };
          break;
        }
        case 'delete': {
          const idx = db.entries.findIndex((x) => x.id === p.id);
          if (idx < 0) throw new ApiError('not_found');
          if (locked(monthOf(db.entries[idx].date))) throw new ApiError('locked');
          db.entries.splice(idx, 1); out = { id: p.id };
          break;
        }
        case 'settle': {
          if (locked(p.month)) throw new ApiError('already_settled');
          const sum = summarize(db.entries.filter((e) => monthOf(e.date) === p.month), DEFAULT_PAYERS);
          if (!sum.total) throw new ApiError('empty_month');
          const operator = lsGet(LS.lastPayer) || DEFAULT_PAYERS[0];
          db.settlements[p.month] = { month: p.month, status: '已結算', total: sum.total, result: resultText(sum), settledAt: new Date().toISOString(), operator };
          out = { settlement: db.settlements[p.month] };
          break;
        }
        case 'unsettle': {
          if (!locked(p.month)) throw new ApiError('not_settled');
          db.settlements[p.month] = { month: p.month, status: '未結算', total: null, result: '', settledAt: '', operator: '' };
          out = { settlement: db.settlements[p.month] };
          break;
        }
        default: throw new ApiError('invalid', '不支援的動作');
      }
      this.save();
      return JSON.parse(JSON.stringify(Object.assign({ ok: true }, out)));
    }
  };

  const api = (action, payload) => (DEMO ? Demo.call(action, payload) : remoteCall(action, payload));

  async function loadData() {
    const data = await api('list');
    state.entries = (data.entries || []).map((e) => Object.assign({}, e, { amount: Number(e.amount) || 0 }));
    state.settlements = data.settlements || {};
    if (Array.isArray(data.payers) && data.payers.length) state.payers = data.payers;
    if (Array.isArray(data.categories) && data.categories.length) state.categories = data.categories;
    state.user = data.user || null;
    state.loaded = true;
  }

  /* ---------------------------------------------------------
     提示訊息與對話框
     --------------------------------------------------------- */
  function toast(message, opts = {}) {
    const type = opts.type || 'info';
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    const ic = type === 'success' ? 'checkCircle' : type === 'error' ? 'xCircle' : 'info';
    el.innerHTML = `${icon(ic)}<span class="toast__msg">${esc(message)}</span>` +
      (opts.action ? `<button type="button" class="toast__action">${esc(opts.action.label)}</button>` : '');
    if (type === 'error') el.setAttribute('role', 'alert');
    const close = () => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 220); };
    if (opts.action) $('.toast__action', el).addEventListener('click', () => { close(); opts.action.onClick(); });
    const box = $('#toasts');
    while (box.children.length >= 2) box.firstElementChild.remove();
    box.appendChild(el);
    setTimeout(close, opts.duration || (opts.action ? 5200 : type === 'error' ? 4800 : 2800));
  }

  const dlg = () => $('#dialog');
  let dialogOnClose = null;

  function openDialog(html, { dismissable = true, onClose = null } = {}) {
    const d = dlg();
    if (d.open) d.close();
    d.innerHTML = html;
    d.dataset.dismissable = dismissable ? '1' : '0';
    dialogOnClose = onClose;
    d.showModal();
  }
  function closeDialog() { const d = dlg(); if (d.open) d.close(); }

  function initDialog() {
    const d = dlg();
    d.addEventListener('cancel', (ev) => { if (d.dataset.dismissable === '0') ev.preventDefault(); });
    d.addEventListener('click', (ev) => { if (ev.target === d && d.dataset.dismissable !== '0') d.close(); });
    d.addEventListener('close', () => {
      const cb = dialogOnClose; dialogOnClose = null;
      if (cb) cb();
    });
  }

  /**
   * 確認視窗：按下確認後執行 action（顯示讀取中），成功才關閉；失敗顯示錯誤並保留視窗。
   */
  function confirmDialog({ tone = 'warn', iconName = 'alert', title, body = '', confirmText = '確認', confirmClass = 'btn--primary', cancelText = '取消', action }) {
    return new Promise((resolve) => {
      let done = false;
      openDialog(`
        <form method="dialog" class="dialog__body">
          <div class="dialog__head">
            <span class="dialog__icon dialog__icon--${tone}">${icon(iconName, 'icon--l')}</span>
            <h2 class="dialog__title" id="dialog-title">${title}</h2>
          </div>
          ${body}
          <div class="dialog__actions">
            <button type="button" class="btn btn--ghost" data-act="cancel">${esc(cancelText)}</button>
            <button type="button" class="btn ${confirmClass}" data-act="ok">${esc(confirmText)}</button>
          </div>
        </form>`, { onClose: () => { if (!done && !okBtn.classList.contains('is-loading')) resolve(false); } });
      const d = dlg();
      const okBtn = $('[data-act="ok"]', d);
      $('[data-act="cancel"]', d).addEventListener('click', () => closeDialog());
      okBtn.addEventListener('click', async () => {
        if (okBtn.classList.contains('is-loading')) return;
        okBtn.classList.add('is-loading');
        d.dataset.dismissable = '0';
        try {
          if (action) await action();
          done = true;
          closeDialog();
          resolve(true);
        } catch (err) {
          toast(errorMessage(err), { type: 'error' });
          okBtn.classList.remove('is-loading');
          d.dataset.dismissable = '1';
        }
      });
      setTimeout(() => $('[data-act="cancel"]', d).focus(), 30);
    });
  }

  /* ---------------------------------------------------------
     路由
     --------------------------------------------------------- */
  function parseRoute() {
    const parts = currentHash().replace(/^#\/?/, '').split('/').filter(Boolean);
    const [page, arg] = parts;
    if (page === 'record') return { name: 'record' };
    if (page === 'edit' && arg) return { name: 'edit', id: decodeURIComponent(arg) };
    if (page === 'month') return { name: 'month', month: arg && isValidMonth(arg) ? arg : currentMonth() };
    return { name: 'home' };
  }
  // MEMORY_ROUTER：嵌入式預覽環境不允許改網址 hash 時，改在記憶體中切換頁面
  const MEMORY_ROUTER = !!CFG.MEMORY_ROUTER;
  let memoryHash = '#/';
  const currentHash = () => (MEMORY_ROUTER ? memoryHash : location.hash);
  const go = (hash) => {
    if (MEMORY_ROUTER) { memoryHash = hash; render(); return; }
    if (location.hash === hash) render(); else location.hash = hash;
  };

  let currentRouteKey = '';
  function render() {
    const app = $('#app');
    if (state.bootError) { renderGate(app); return; }
    if (!state.loaded) { app.innerHTML = skeletonView(); return; }
    const route = parseRoute();
    const key = JSON.stringify(route);
    const sameRoute = key === currentRouteKey;
    currentRouteKey = key;
    if (route.name === 'home') homeView(app);
    else if (route.name === 'month') monthView(app, route.month);
    else if (route.name === 'record') recordView(app, null);
    else if (route.name === 'edit') recordView(app, route.id);
    if (!sameRoute) window.scrollTo(0, 0);
    const title = { home: '家用收支簿', month: '每月支出', record: '記帳', edit: '編輯明細' }[route.name];
    document.title = route.name === 'home' ? title : `${title}｜家用收支簿`;
  }

  /* ---------------------------------------------------------
     畫面：共用片段
     --------------------------------------------------------- */
  function statusBadge(ym) {
    return isSettled(ym)
      ? `<span class="badge badge--settled">${icon('check')}已結算</span>`
      : '<span class="badge badge--unsettled">未結算</span>';
  }

  function settleLine(sum) {
    if (!sum.total) {
      return `<div class="settle-line settle-line--zero"><span class="settle-line__k">尚無支出</span><span class="settle-line__v">無需結算</span></div>`;
    }
    const per = `每人應分攤 <span class="num">${fmt(sum.share)}</span>`;
    const v = sum.transfer && sum.transfer.amount
      ? `${esc(sum.transfer.from)} ${icon('arrow', 'icon--s')} ${esc(sum.transfer.to)} <span class="num">${fmt(sum.transfer.amount)}</span>`
      : '兩人已付相同';
    return `<div class="settle-line"><span class="settle-line__k">${per}</span><span class="settle-line__v">${v}</span></div>`;
  }

  function paidGrid(sum) {
    return `<div class="split-grid">${state.payers.map((p) => `
      <div class="split-cell">
        <div class="split-cell__k">${esc(p)} 已付</div>
        <div class="split-cell__v num">${fmt(sum.paid[p] || 0)}</div>
      </div>`).join('')}</div>`;
  }

  function demoBanner() {
    if (!DEMO) return '';
    return `<div class="demo-banner">${icon('beaker')}<span>示範模式：資料只存在這台裝置</span><button type="button" data-act="reset-demo">重設範例</button></div>`;
  }

  function skeletonView() {
    return `
      <header class="topbar topbar--home"><div class="topbar__brand">${icon('house', 'icon--l')}<h1>家用收支簿</h1></div></header>
      <main class="page" aria-busy="true">
        <div class="skeleton" style="height:210px"></div>
        <div class="skeleton" style="height:24px;width:40%"></div>
        <div class="skeleton" style="height:64px"></div>
        <div class="skeleton" style="height:64px"></div>
        <div class="skeleton" style="height:64px"></div>
        <span class="sr-only">載入中</span>
      </main>`;
  }

  /* ---------------------------------------------------------
     畫面：首頁
     --------------------------------------------------------- */
  function homeView(app) {
    const cur = currentMonth();
    const prev = addMonths(cur, -1);
    const sum = summary(cur);
    const prevCount = entriesOf(prev).length;
    const recent = [1, 2, 3].map((n) => addMonths(cur, -n));
    const recentSums = recent.map((m) => summary(m).total);
    const maxRecent = Math.max(1, ...recentSums);
    const userInitial = state.user && state.user.name ? [...state.user.name][0] : '';

    app.innerHTML = `
      <header class="topbar topbar--home">
        <div class="topbar__brand">${icon('house', 'icon--l')}<h1>家用收支簿</h1></div>
        <div class="topbar__actions">
          <button type="button" class="icon-btn" data-act="refresh" aria-label="重新整理資料">${icon('refresh')}</button>
          ${!DEMO && userInitial ? `<button type="button" class="icon-btn" data-act="account" aria-label="帳號：${esc(state.user.name)}"><span class="avatar">${esc(userInitial)}</span></button>` : ''}
        </div>
      </header>
      ${demoBanner()}
      <main class="page page--with-bar">
        ${!isSettled(prev) && prevCount ? `
          <a class="alert alert--warn" href="#/month/${prev}">
            <span class="alert__main">${icon('alert')}${shortMonth(prev)}尚未結算</span>
            <span class="alert__go">前往結算 ›</span>
          </a>` : ''}

        <section class="card" aria-labelledby="cur-title">
          <div class="card__head">
            <h2 class="card__label" id="cur-title">本月支出（${shortMonth(cur)}）</h2>
            ${statusBadge(cur)}
          </div>
          <div class="big-amount num">NT$ ${fmt(sum.total)}</div>
          ${paidGrid(sum)}
          ${settleLine(sum)}
          <a class="link-more" href="#/month/${cur}">查看本月明細 ${icon('chevR', 'icon--s')}</a>
        </section>

        <section aria-labelledby="recent-title" style="display:flex;flex-direction:column;gap:8px">
          <h2 class="section-title" id="recent-title">${icon('calendar')}近三個月</h2>
          <div class="month-list">
            ${recent.map((m, i) => `
              <a class="month-row" href="#/month/${m}" aria-label="${monthLabel(m)}，NT$ ${fmt(recentSums[i])}，${isSettled(m) ? '已結算' : '未結算'}">
                <span class="month-row__top">
                  <span class="month-row__m">${shortMonth(m)}</span>
                  <span class="month-row__amt num">NT$ ${fmt(recentSums[i])}</span>
                  ${statusBadge(m)}
                  <span class="month-row__chev">${icon('chevR', 'icon--s')}</span>
                </span>
                <span class="month-row__bar" aria-hidden="true"><span style="width:${(recentSums[i] / maxRecent) * 100}%"></span></span>
              </a>`).join('')}
          </div>
        </section>
      </main>
      <div class="bottom-bar">
        <a class="btn btn--cta btn--lg btn--block" href="#/record">${icon('plus', 'icon--l')}記帳</a>
      </div>`;

    bindCommon(app);
    const accountBtn = $('[data-act="account"]', app);
    if (accountBtn) accountBtn.addEventListener('click', showAccount);
  }

  function bindCommon(app) {
    const refreshBtn = $('[data-act="refresh"]', app);
    if (refreshBtn) refreshBtn.addEventListener('click', async () => {
      refreshBtn.classList.add('is-spinning');
      try {
        await loadData();
        render();
        toast('已更新為最新資料', { type: 'success' });
      } catch (err) {
        refreshBtn.classList.remove('is-spinning');
        toast(errorMessage(err), { type: 'error' });
      }
    });
    const resetBtn = $('[data-act="reset-demo"]', app);
    if (resetBtn) resetBtn.addEventListener('click', () => {
      confirmDialog({
        tone: 'info', iconName: 'beaker', title: '重設示範資料？',
        body: '<p class="dialog__text">會清除你在示範模式新增或修改的內容，恢復成範例資料。</p>',
        confirmText: '重設', action: async () => { Demo.reset(); await loadData(); }
      }).then((ok) => { if (ok) { render(); toast('已重設範例資料', { type: 'success' }); } });
    });
  }

  function showAccount() {
    const me = state.user && state.user.name;
    openDialog(`
      <div class="dialog__body">
        <div class="dialog__head">
          <span class="dialog__icon dialog__icon--info"><span class="avatar">${esc([...(me || '?')][0])}</span></span>
          <h2 class="dialog__title" id="dialog-title">目前身分：${esc(me || '未選擇')}</h2>
        </div>
        <div class="field">
          <span class="field__label">這台裝置是誰在用</span>
          <div class="seg">${state.payers.map((p) => `<button type="button" class="choice" data-me="${esc(p)}" aria-pressed="${p === me}">${esc(p)}</button>`).join('')}</div>
        </div>
        <p class="dialog__text">身分會用在結算的「操作人」與記帳時預設的付款人。</p>
        <div class="dialog__actions">
          <button type="button" class="btn btn--ghost" data-act="logout">${icon('logout', 'icon--s')}登出</button>
          <button type="button" class="btn btn--primary" data-act="close">完成</button>
        </div>
      </div>`);
    const d = dlg();
    $$('[data-me]', d).forEach((b) => b.addEventListener('click', () => {
      Pass.setMe(b.dataset.me);
      state.user = { name: b.dataset.me };
      $$('[data-me]', d).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('#dialog-title', d).textContent = `目前身分：${b.dataset.me}`;
    }));
    $('[data-act="close"]', d).addEventListener('click', () => { closeDialog(); render(); });
    $('[data-act="logout"]', d).addEventListener('click', () => {
      Pass.clear();
      closeDialog();
      state.loaded = false;
      state.bootError = { kind: 'login' };
      go('#/');
    });
  }

  /* ---------------------------------------------------------
     畫面：每月支出
     --------------------------------------------------------- */
  function monthView(app, ym) {
    const cur = currentMonth();
    const entries = entriesOf(ym);
    const sum = summarize(entries, state.payers);
    const settled = settlementOf(ym);
    const atLatest = ym >= cur;

    const catTotals = state.categories.map((c, i) => ({ c, i, amt: entries.filter((e) => e.category === c).reduce((s, e) => s + e.amount, 0) }));
    // 不在設定清單內的分類（例如在 Sheet 手動輸入）也要算進去
    const known = new Set(state.categories);
    entries.forEach((e) => {
      if (!known.has(e.category)) {
        known.add(e.category);
        catTotals.push({ c: e.category, i: catTotals.length, amt: entries.filter((x) => x.category === e.category).reduce((s, x) => s + x.amount, 0) });
      }
    });
    catTotals.sort((a, b) => b.amt - a.amt || a.i - b.i);
    const maxCat = Math.max(1, ...catTotals.map((x) => x.amt));
    const snapshotMismatch = settled && settled.total !== null && settled.total !== '' && Number(settled.total) !== sum.total;

    app.innerHTML = `
      <header class="topbar">
        <a class="back" href="#/">${icon('chevL')}首頁</a>
        <h1 class="topbar__title">每月支出</h1>
        <div class="topbar__end">
          <button type="button" class="icon-btn" data-act="refresh" aria-label="重新整理資料">${icon('refresh')}</button>
        </div>
      </header>
      <main class="page">
        <nav class="month-nav" aria-label="切換月份">
          <a class="nav-btn" href="#/month/${addMonths(ym, -1)}" aria-label="上個月">${icon('chevL')}</a>
          <h2 class="month-nav__label">${monthLabel(ym)}</h2>
          ${atLatest
            ? `<button type="button" class="nav-btn" disabled aria-label="下個月">${icon('chevR')}</button>`
            : `<a class="nav-btn" href="#/month/${addMonths(ym, 1)}" aria-label="下個月">${icon('chevR')}</a>`}
        </nav>

        <section class="card ${settled ? 'card--settled' : ''}" aria-label="本月總計與結算">
          <div class="card__head">
            ${settled
              ? `<div class="status-stack">${statusBadge(ym)}<span class="settled-meta">${settledDateLabel(settled.settledAt)} 由 ${esc(settled.operator || '—')} 結算</span></div>
                 <button type="button" class="btn btn--ghost btn--sm" data-act="unsettle">${icon('unlock', 'icon--s')}取消結算</button>`
              : `${statusBadge(ym)}
                 <button type="button" class="btn btn--primary btn--sm" data-act="settle" ${sum.total ? '' : 'disabled title="本月沒有支出"'}>${icon('check', 'icon--s')}標記為已結算</button>`}
          </div>
          <div class="card__head" style="align-items:baseline">
            <span class="card__label">本月總計</span>
            <span class="mid-amount num">NT$ ${fmt(sum.total)}</span>
          </div>
          ${sum.total ? paidGrid(sum) : ''}
          ${settleLine(sum)}
        </section>

        ${settled ? `<div class="notice">${icon('lock')}<span>本月已結算，明細已鎖定。需要修改請先取消結算。</span></div>` : ''}
        ${snapshotMismatch ? `<div class="alert alert--warn" role="alert"><span class="alert__main">${icon('alert')}結算後 Sheet 的資料有變動（結算時總額 ${fmt(settled.total)}），建議取消結算後重新結算。</span></div>` : ''}

        <section aria-labelledby="cat-title" style="display:flex;flex-direction:column;gap:12px">
          <h2 class="section-title" id="cat-title">${icon('pie')}分類支出</h2>
          ${sum.total ? `<div class="bars">
            ${catTotals.map((x) => `
              <div class="bar-row ${x.amt ? '' : 'is-zero'}">
                ${icon(catIcon(x.c))}
                <span class="bar-row__name">${esc(x.c)}</span>
                <span class="bar-row__track" role="img" aria-label="${esc(x.c)} 占 ${Math.round((x.amt / sum.total) * 100)}%"><span class="bar-row__fill" style="display:block;width:${x.amt ? (x.amt / maxCat) * 100 : 0}%;background:${catColor(x.c, x.i)}"></span></span>
                <span class="bar-row__val num"><b>${fmt(x.amt)}</b><small>${Math.round((x.amt / sum.total) * 100)}%</small></span>
              </div>`).join('')}
          </div>` : '<p class="hint">本月還沒有支出，記帳後就會出現分類圖表。</p>'}
        </section>

        <section aria-labelledby="list-title" style="display:flex;flex-direction:column;gap:4px">
          <h2 class="section-title" id="list-title">${icon('list')}明細 <span class="hint" style="font-weight:600">（${entries.length} 筆・日期近 → 遠）</span></h2>
          ${entries.length ? `<div class="entries">
            ${entries.map((e) => {
              const inner = `
                <span class="entry__date num">${mdLabel(e.date)}</span>
                <span class="entry__main">
                  <span class="entry__name">${esc(e.name)}</span>
                  <span class="entry__sub">${icon(catIcon(e.category))}${esc(e.category)}・${esc(e.payer)}</span>
                </span>
                <span class="entry__amt num">${fmt(e.amount)}</span>`;
              return settled
                ? `<div class="entry">${inner}<span class="entry__end" role="img" aria-label="已鎖定">${icon('lock')}</span></div>`
                : `<button type="button" class="entry" data-edit="${esc(e.id)}" aria-label="編輯 ${esc(e.name)}，${fmt(e.amount)} 元">${inner}<span class="entry__end">${icon('chevR')}</span></button>`;
            }).join('')}
          </div>
          <p class="hint" style="text-align:center;padding-top:10px">${settled ? '已結算月份的明細無法編輯' : '點明細可編輯或刪除'}</p>`
          : `<div class="empty">${icon('inbox')}<strong>這個月還沒有記帳</strong>${!settled && ym <= cur ? '<a class="btn btn--cta btn--sm" href="#/record">' + icon('plus', 'icon--s') + '記一筆</a>' : ''}</div>`}
        </section>
      </main>`;

    bindCommon(app);
    $$('[data-edit]', app).forEach((b) => b.addEventListener('click', () => go(`#/edit/${encodeURIComponent(b.dataset.edit)}`)));

    const settleBtn = $('[data-act="settle"]', app);
    if (settleBtn) settleBtn.addEventListener('click', () => {
      const s = summary(ym);
      const resultHtml = s.transfer && s.transfer.amount
        ? `${esc(s.transfer.from)} 應付給 ${esc(s.transfer.to)} <span class="num">${fmt(s.transfer.amount)}</span> 元`
        : '兩人已付相同，無需補付';
      confirmDialog({
        tone: 'warn', iconName: 'clock',
        title: `確認結算<br>${monthLabel(ym)}？`,
        body: `
          <div class="sum-table">
            <div class="sum-table__row"><span>本月總支出</span><span class="num">NT$ ${fmt(s.total)}</span></div>
            <div class="sum-table__row"><span>每人應分攤</span><span class="num">${fmt(s.share)}</span></div>
            ${state.payers.map((p) => `<div class="sum-table__row"><span>${esc(p)} 已付</span><span class="num">${fmt(s.paid[p] || 0)}</span></div>`).join('')}
          </div>
          <div class="result-box">${resultHtml}</div>
          <p class="lock-note">${icon('lock')}<span>結算後本月明細將鎖定，無法新增、修改或刪除；需要修改時請先取消結算。</span></p>`,
        confirmText: '確認結算',
        action: async () => {
          const res = await api('settle', { month: ym });
          state.settlements[ym] = res.settlement;
        }
      }).then((ok) => {
        if (ok) { render(); toast(`${monthLabel(ym)}已結算`, { type: 'success' }); }
      });
    });

    const unsettleBtn = $('[data-act="unsettle"]', app);
    if (unsettleBtn) unsettleBtn.addEventListener('click', () => {
      confirmDialog({
        tone: 'warn', iconName: 'unlock',
        title: `取消 ${monthLabel(ym)} 的結算？`,
        body: '<p class="dialog__text">取消後本月明細會解除鎖定，可以新增、修改或刪除；改完記得重新標記為已結算。</p>',
        confirmText: '取消結算', cancelText: '返回',
        action: async () => {
          const res = await api('unsettle', { month: ym });
          state.settlements[ym] = res.settlement;
        }
      }).then((ok) => {
        if (ok) { render(); toast(`${monthLabel(ym)}已改回未結算`, { type: 'success' }); }
      });
    });
  }

  /* ---------------------------------------------------------
     畫面：記帳 / 編輯明細
     --------------------------------------------------------- */
  function recordView(app, editId) {
    let original = null;
    if (editId) {
      original = state.entries.find((e) => e.id === editId);
      if (!original) {
        toast(ERROR_TEXT.not_found, { type: 'error' });
        go('#/');
        return;
      }
      if (isSettled(monthOf(original.date))) {
        toast('這筆明細所在月份已結算，請先取消結算', { type: 'error' });
        go(`#/month/${monthOf(original.date)}`);
        return;
      }
    }
    const isEdit = !!original;
    const lastPayer = lsGet(LS.lastPayer);
    const defaultPayer = state.payers.includes(lastPayer) ? lastPayer
      : (state.user && state.payers.includes(state.user.name)) ? state.user.name : '';
    const draft = isEdit
      ? { id: original.id, date: original.date, payer: original.payer, category: original.category, name: original.name, amount: original.amount }
      : { date: todayStr(), payer: defaultPayer, category: '', name: '', amount: null };
    let categoryTouched = isEdit;
    const backHref = isEdit ? `#/month/${monthOf(original.date)}` : '#/';

    // 常用名稱（最近使用優先）
    const seen = new Set();
    const recentNames = state.entries.slice().sort(byNewest).filter((e) => {
      if (seen.has(e.name)) return false; seen.add(e.name); return true;
    }).slice(0, 40);

    app.innerHTML = `
      <header class="topbar">
        <a class="back" href="${backHref}">${icon('chevL')}${isEdit ? '每月支出' : '首頁'}</a>
        <h1 class="topbar__title">${isEdit ? '編輯明細' : '記帳'}</h1>
        <span></span>
      </header>
      <main class="page page--with-bar">
        <form class="form" id="entry-form" novalidate>
          <div class="field" data-field="date">
            <div class="field__meta" style="font-size:13px">
              <label for="f-date" class="field__label">日期</label>
              <span class="date-today" id="date-hint"></span>
            </div>
            <div class="input-wrap">
              <input id="f-date" class="input num" type="date" required value="${esc(draft.date)}">
              <span class="input-wrap__icon">${icon('calendar')}</span>
            </div>
            <p class="field__err" id="err-date">${icon('xCircle')}<span></span></p>
          </div>

          <fieldset class="field" data-field="payer">
            <legend class="field__label">誰付錢</legend>
            <div class="seg" role="group" aria-label="誰付錢" style="margin-top:8px">
              ${state.payers.map((p) => `<button type="button" class="choice" data-payer="${esc(p)}" aria-pressed="${p === draft.payer}">${esc(p)}</button>`).join('')}
            </div>
            <p class="field__err" id="err-payer">${icon('xCircle')}<span></span></p>
          </fieldset>

          <fieldset class="field" data-field="category">
            <legend class="field__label">分類</legend>
            <div class="cat-grid" role="group" aria-label="分類" style="margin-top:8px">
              ${state.categories.map((c) => `<button type="button" class="choice" data-cat="${esc(c)}" aria-pressed="${c === draft.category}">${icon(catIcon(c))}${esc(c)}</button>`).join('')}
            </div>
            <p class="field__err" id="err-category">${icon('xCircle')}<span></span></p>
          </fieldset>

          <div class="field" data-field="name">
            <label for="f-name" class="field__label">名稱</label>
            <input id="f-name" class="input" type="text" maxlength="${MAX_NAME}" autocomplete="off" list="name-list" placeholder="例如：全聯採買" value="${esc(draft.name)}" enterkeyhint="next">
            <datalist id="name-list">${recentNames.map((e) => `<option value="${esc(e.name)}"></option>`).join('')}</datalist>
            <p class="field__err" id="err-name">${icon('xCircle')}<span></span></p>
          </div>

          <div class="field" data-field="amount">
            <label for="f-amount" class="field__label">金額（新台幣元）</label>
            <div class="amount">
              <span class="amount__prefix" aria-hidden="true">NT$</span>
              <input id="f-amount" class="input" type="text" inputmode="numeric" pattern="[0-9,]*" autocomplete="off" placeholder="0" value="${draft.amount ? fmt(draft.amount) : ''}" enterkeyhint="done">
            </div>
            <p class="field__err" id="err-amount">${icon('xCircle')}<span></span></p>
          </div>
          <button type="submit" hidden></button>
        </form>
      </main>
      <div class="bottom-bar">
        ${isEdit
          ? `<div class="bottom-bar__row">
              <button type="button" class="btn btn--danger-ghost btn--lg" data-act="delete">${icon('trash')}刪除</button>
              <button type="button" class="btn btn--primary btn--lg" data-act="submit">儲存</button>
            </div>`
          : `<button type="button" class="btn btn--primary btn--lg btn--block" data-act="submit">送出</button>`}
      </div>`;

    const form = $('#entry-form', app);
    const dateEl = $('#f-date', app);
    const nameEl = $('#f-name', app);
    const amountEl = $('#f-amount', app);
    const submitBtn = $('[data-act="submit"]', app);

    const setErr = (field, msg) => {
      const box = $(`[data-field="${field}"]`, form);
      box.classList.toggle('has-error', !!msg);
      $(`#err-${field} span`, form).textContent = msg || '';
      const input = $('input', box);
      if (input && field !== 'payer' && field !== 'category') {
        if (msg) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', `err-${field}`); }
        else { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }
      }
    };

    const updateDateHint = () => {
      const hint = $('#date-hint', app);
      if (!isValidDate(draft.date)) { hint.textContent = ''; return; }
      hint.textContent = draft.date === todayStr() ? `今天・週${weekday(draft.date)}` : `週${weekday(draft.date)}`;
      const ym = monthOf(draft.date);
      const sameAsOriginal = isEdit && monthOf(original.date) === ym;
      setErr('date', isSettled(ym) && !sameAsOriginal ? `${monthLabel(ym)}已結算，無法記在這個月份；需要時請先取消結算` : '');
    };
    updateDateHint();

    dateEl.addEventListener('change', () => { draft.date = dateEl.value; updateDateHint(); });
    dateEl.addEventListener('input', () => { draft.date = dateEl.value; updateDateHint(); });

    $$('[data-payer]', form).forEach((b) => b.addEventListener('click', () => {
      draft.payer = b.dataset.payer;
      $$('[data-payer]', form).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      setErr('payer', '');
    }));
    $$('[data-cat]', form).forEach((b) => b.addEventListener('click', () => {
      draft.category = b.dataset.cat;
      categoryTouched = true;
      $$('[data-cat]', form).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      setErr('category', '');
    }));

    nameEl.addEventListener('input', () => { draft.name = nameEl.value; setErr('name', ''); });
    nameEl.addEventListener('change', () => {
      // 選了以前用過的名稱：若還沒選分類，自動帶入上次的分類
      if (categoryTouched) return;
      const prev = state.entries.slice().sort(byNewest).find((e) => e.name === nameEl.value.trim());
      if (prev && state.categories.includes(prev.category)) {
        draft.category = prev.category;
        $$('[data-cat]', form).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.cat === prev.category)));
        setErr('category', '');
      }
    });
    nameEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); amountEl.focus(); } });

    amountEl.addEventListener('input', () => {
      const digits = amountEl.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 6);
      draft.amount = digits ? Number(digits) : null;
      amountEl.value = digits ? fmt(digits) : '';
      setErr('amount', '');
    });

    const submit = async () => {
      if (submitBtn.classList.contains('is-loading')) return;
      const entry = { date: draft.date, payer: draft.payer, category: draft.category, name: (draft.name || '').trim(), amount: draft.amount };
      const errors = validateEntry(entry);
      if (isEdit && errors.date && isSettled(monthOf(entry.date)) && monthOf(original.date) === monthOf(entry.date)) delete errors.date;
      ['date', 'payer', 'category', 'name', 'amount'].forEach((f) => setErr(f, errors[f]));
      const first = ['date', 'payer', 'category', 'name', 'amount'].find((f) => errors[f]);
      if (first) {
        const target = $(`[data-field="${first}"]`, form);
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const focusEl = $('input', target) || $('button', target);
        if (focusEl) setTimeout(() => focusEl.focus({ preventScroll: true }), 250);
        return;
      }
      submitBtn.classList.add('is-loading');
      try {
        if (isEdit) {
          const res = await api('update', { entry: Object.assign({ id: original.id }, entry) });
          Object.assign(original, res.entry, { amount: Number(res.entry.amount) });
          lsSet(LS.lastPayer, entry.payer);
          toast('已儲存修改', { type: 'success' });
          go(`#/month/${monthOf(res.entry.date)}`);
        } else {
          const res = await api('create', { entry });
          state.entries.push(Object.assign({}, res.entry, { amount: Number(res.entry.amount) }));
          lsSet(LS.lastPayer, entry.payer);
          go('#/');
          toast(`已記下：${entry.name} NT$ ${fmt(entry.amount)}`, {
            type: 'success',
            action: { label: '再記一筆', onClick: () => go('#/record') }
          });
        }
      } catch (err) {
        submitBtn.classList.remove('is-loading');
        if (err.code === 'locked') updateDateHint();
        toast(errorMessage(err), { type: 'error' });
      }
    };
    submitBtn.addEventListener('click', submit);
    form.addEventListener('submit', (ev) => { ev.preventDefault(); submit(); });

    const delBtn = $('[data-act="delete"]', app);
    if (delBtn) delBtn.addEventListener('click', () => {
      confirmDialog({
        tone: 'danger', iconName: 'trash', title: '刪除這筆明細？',
        body: `
          <div class="sum-table">
            <div class="sum-table__row"><span>${mdLabel(original.date)}・${esc(original.payer)}</span><span>${esc(original.name)}</span></div>
            <div class="sum-table__row"><span>金額</span><span class="num">NT$ ${fmt(original.amount)}</span></div>
          </div>
          <p class="dialog__text">刪除後無法在網站上復原（必要時可從 Google Sheet 的版本記錄找回）。</p>`,
        confirmText: '刪除', confirmClass: 'btn--danger',
        action: async () => {
          await api('delete', { id: original.id });
          state.entries = state.entries.filter((e) => e.id !== original.id);
        }
      }).then((ok) => {
        if (ok) { toast('已刪除這筆明細', { type: 'success' }); go(`#/month/${monthOf(original.date)}`); }
      });
    });

    if (!isEdit && !('ontouchstart' in window)) setTimeout(() => nameEl.focus({ preventScroll: true }), 50);
  }

  /* ---------------------------------------------------------
     登入 / 錯誤畫面
     --------------------------------------------------------- */
  function renderGate(app) {
    const e = state.bootError;
    if (e.kind === 'login') {
      const me = Pass.me && state.payers.includes(Pass.me) ? Pass.me : '';
      app.innerHTML = `
        <main class="gate">
          <span class="gate__logo" aria-hidden="true"></span>
          <h1>家用收支簿</h1>
          <form class="form" id="gate-form" style="width:100%;max-width:300px;text-align:left" novalidate>
            <div class="field">
              <label for="f-pass" class="field__label">家庭密碼</label>
              <input id="f-pass" class="input" type="password" autocomplete="current-password" enterkeyhint="go" required>
            </div>
            <fieldset class="field">
              <legend class="field__label">我是</legend>
              <div class="seg" style="margin-top:8px">${state.payers.map((p) => `<button type="button" class="choice" data-me="${esc(p)}" aria-pressed="${p === me}">${esc(p)}</button>`).join('')}</div>
            </fieldset>
            <p class="gate__err" id="gate-err" role="alert">${esc(e.message || '')}</p>
            <button type="submit" class="btn btn--primary btn--lg btn--block">進入</button>
            <p class="hint" style="text-align:center">這台裝置會記住密碼，下次不用再輸入</p>
          </form>
        </main>`;
      const form = $('#gate-form', app);
      const passEl = $('#f-pass', app);
      const errEl = $('#gate-err', app);
      const submitBtn = $('button[type="submit"]', form);
      let chosen = me;
      $$('[data-me]', form).forEach((b) => b.addEventListener('click', () => {
        chosen = b.dataset.me;
        $$('[data-me]', form).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      }));
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (submitBtn.classList.contains('is-loading')) return;
        const code = passEl.value;
        if (!code) { errEl.textContent = '請輸入密碼'; passEl.focus(); return; }
        if (!chosen) { errEl.textContent = '請選擇你是誰'; return; }
        errEl.textContent = '';
        submitBtn.classList.add('is-loading');
        Pass.save(code, chosen);
        try {
          await loadData();
          state.bootError = null;
          render();
        } catch (err) {
          if (err.code === 'unauthorized') Pass.clear();
          submitBtn.classList.remove('is-loading');
          errEl.textContent = errorMessage(err);
          passEl.select();
        }
      });
      setTimeout(() => passEl.focus(), 50);
      return;
    }
    app.innerHTML = `
      <main class="gate">
        <span class="gate__logo" aria-hidden="true"></span>
        <h1>家用收支簿</h1>
        <p class="gate__err">${esc(e.message)}</p>
        <button type="button" class="btn btn--primary" data-act="retry">${icon('refresh', 'icon--s')}重試</button>
      </main>`;
    $('[data-act="retry"]', app).addEventListener('click', () => { state.bootError = null; boot(); });
  }

  /* ---------------------------------------------------------
     啟動
     --------------------------------------------------------- */
  async function boot() {
    render();
    try {
      if (DEMO) {
        Demo.load();
      } else {
        Pass.restore();
        if (!Pass.code || !Pass.me) {
          state.bootError = { kind: 'login' };
          render();
          return;
        }
      }
      await loadData();
      state.bootError = null;
    } catch (err) {
      if (err && err.code === 'unauthorized') { Pass.clear(); state.bootError = { kind: 'login', message: errorMessage(err) }; }
      else state.bootError = { kind: 'error', message: err instanceof ApiError ? errorMessage(err) : (err && err.message) || '發生錯誤' };
    }
    render();
  }

  initDialog();
  if (MEMORY_ROUTER) {
    document.addEventListener('click', (ev) => {
      const a = ev.target.closest && ev.target.closest('a[href^="#/"]');
      if (!a) return;
      ev.preventDefault();
      go(a.getAttribute('href'));
    });
  } else {
    window.addEventListener('hashchange', render);
  }
  boot();
})();
