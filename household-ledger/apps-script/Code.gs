/**
 * 家用收支簿 — Google Apps Script API
 * ------------------------------------------------------------
 * 放在 Google Sheet 的「擴充功能 → Apps Script」中（綁定該試算表）。
 *
 * 首次使用：
 *   1. 在編輯器上方選擇函式 setup，按「執行」→ 授權。會建立三個工作表：明細、設定、結算。
 *   2. 「專案設定 → 指令碼屬性」新增：
 *        LEDGER_PASSCODE = 自訂的家庭密碼
 *   3. 「部署 → 新增部署作業 → 網頁應用程式」
 *        執行身分：我
 *        誰可以存取：任何人
 *      （網站送來的每個請求都會比對家庭密碼，不正確一律拒絕）
 *
 * 前端以 POST（Content-Type: text/plain）送出 JSON：
 *   { action, passcode, operator, ...參數 }
 * action：list / create / update / delete / settle / unsettle
 */

const SHEET_ENTRIES = '明細';
const SHEET_SETTINGS = '設定';
const SHEET_SETTLE = '結算';

const ENTRY_HEADERS = ['id', '日期', '付款人', '分類', '名稱', '金額', '建立時間', '更新時間'];
const SETTLE_HEADERS = ['月份', '狀態', '結算總金額', '結算結果', '結算時間', '操作人'];
const DEFAULT_PAYERS = ['牧', '虎'];
const DEFAULT_CATEGORIES = ['餐飲食材', 'Sunny', '日常用品', '住宅開銷', '家電傢俱', '其他'];

const MAX_AMOUNT = 999999;
const MAX_NAME = 50;
const STATUS_SETTLED = '已結算';
const STATUS_OPEN = '未結算';

/* ============================================================
   進入點
   ============================================================ */

function doGet() {
  return json_({ ok: true, message: '家用收支簿 API 運作中' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'invalid', message: '請求格式錯誤' });
  }

  try {
    const user = authenticate_(req);
    const handlers = {
      list: () => list_(user),
      create: () => withLock_(() => create_(req.entry)),
      update: () => withLock_(() => update_(req.entry)),
      delete: () => withLock_(() => remove_(req.id)),
      settle: () => withLock_(() => settle_(req.month, user)),
      unsettle: () => withLock_(() => unsettle_(req.month))
    };
    const fn = handlers[req.action];
    if (!fn) throw apiError_('invalid', '不支援的動作');
    return json_(Object.assign({ ok: true }, fn()));
  } catch (err) {
    if (err && err.apiCode) return json_({ ok: false, error: err.apiCode, message: err.message });
    console.error(err && err.stack ? err.stack : err);
    return json_({ ok: false, error: 'server_error', message: String(err && err.message || err) });
  }
}

/* ============================================================
   驗證：家庭密碼
   ============================================================ */

const MAX_FAILS = 10;          // 連續輸錯上限
const FAIL_WINDOW_SEC = 600;   // 超過上限後暫停 10 分鐘

function authenticate_(req) {
  const passcode = PropertiesService.getScriptProperties().getProperty('LEDGER_PASSCODE');
  if (!passcode) throw apiError_('not_configured', '請先在指令碼屬性設定 LEDGER_PASSCODE');

  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('pass_fails') || 0);
  if (fails >= MAX_FAILS) throw apiError_('too_many');

  if (String(req.passcode || '') !== String(passcode)) {
    cache.put('pass_fails', String(fails + 1), FAIL_WINDOW_SEC);
    throw apiError_('unauthorized', '密碼不正確');
  }

  const payers = readSettings_().payers;
  const name = payers.indexOf(req.operator) >= 0 ? req.operator : payers[0];
  return { name: name };
}

/* ============================================================
   動作
   ============================================================ */

function list_(user) {
  const settings = readSettings_();
  const entries = readEntries_(true).map(function (r) { return r.entry; });
  return {
    entries: entries,
    settlements: readSettlements_(),
    payers: settings.payers,
    categories: settings.categories,
    user: user
  };
}

function create_(input) {
  const settings = readSettings_();
  const e = validateEntry_(input, settings);
  assertUnlocked_(monthOf_(e.date));
  const now = new Date();
  const id = Utilities.getUuid();
  const sheet = sheet_(SHEET_ENTRIES);
  sheet.appendRow([id, e.date, e.payer, e.category, e.name, e.amount, now, now]);
  return { entry: Object.assign({ id: id, createdAt: now.toISOString(), updatedAt: now.toISOString() }, e) };
}

function update_(input) {
  if (!input || !input.id) throw apiError_('invalid', '缺少 id');
  const settings = readSettings_();
  const found = findEntryRow_(input.id);
  if (!found) throw apiError_('not_found');
  assertUnlocked_(monthOf_(found.entry.date));
  const e = validateEntry_(input, settings);
  assertUnlocked_(monthOf_(e.date));
  const now = new Date();
  const sheet = sheet_(SHEET_ENTRIES);
  sheet.getRange(found.row, 2, 1, 5).setValues([[e.date, e.payer, e.category, e.name, e.amount]]);
  sheet.getRange(found.row, 8).setValue(now);
  return { entry: Object.assign({ id: input.id, createdAt: found.entry.createdAt, updatedAt: now.toISOString() }, e) };
}

function remove_(id) {
  if (!id) throw apiError_('invalid', '缺少 id');
  const found = findEntryRow_(id);
  if (!found) throw apiError_('not_found');
  assertUnlocked_(monthOf_(found.entry.date));
  sheet_(SHEET_ENTRIES).deleteRow(found.row);
  return { id: id };
}

function settle_(month, user) {
  assertMonth_(month);
  const settlements = readSettlements_();
  if (settlements[month] && settlements[month].status === STATUS_SETTLED) throw apiError_('already_settled');
  const settings = readSettings_();
  const entries = readEntries_(false).map(function (r) { return r.entry; }).filter(function (e) { return monthOf_(e.date) === month; });
  const sum = summarize_(entries, settings.payers);
  if (!sum.total) throw apiError_('empty_month');
  const now = new Date();
  const result = resultText_(sum);
  writeSettlement_(month, [month, STATUS_SETTLED, sum.total, result, now, user.name]);
  return { settlement: { month: month, status: STATUS_SETTLED, total: sum.total, result: result, settledAt: now.toISOString(), operator: user.name } };
}

function unsettle_(month) {
  assertMonth_(month);
  const settlements = readSettlements_();
  if (!settlements[month] || settlements[month].status !== STATUS_SETTLED) throw apiError_('not_settled');
  writeSettlement_(month, [month, STATUS_OPEN, '', '', '', '']);
  return { settlement: { month: month, status: STATUS_OPEN, total: null, result: '', settledAt: '', operator: '' } };
}

/* ============================================================
   計算（與網站相同規則）
   ============================================================ */

function summarize_(entries, payers) {
  const paid = {};
  payers.forEach(function (p) { paid[p] = 0; });
  let total = 0;
  entries.forEach(function (e) {
    total += e.amount;
    paid[e.payer] = (paid[e.payer] || 0) + e.amount;
  });
  const share = Math.round(total / Math.max(payers.length, 1));
  let transfer = null;
  if (payers.length === 2 && total > 0 && paid[payers[0]] !== paid[payers[1]]) {
    const debtor = paid[payers[0]] < paid[payers[1]] ? payers[0] : payers[1];
    const creditor = debtor === payers[0] ? payers[1] : payers[0];
    transfer = { from: debtor, to: creditor, amount: share - paid[debtor] };
  }
  return { total: total, paid: paid, share: share, transfer: transfer };
}

function resultText_(sum) {
  if (!sum.total) return '本月無支出';
  if (!sum.transfer || !sum.transfer.amount) return '兩人已付相同，無需補付';
  return sum.transfer.from + '→' + sum.transfer.to + ' ' + sum.transfer.amount.toLocaleString('en-US');
}

/* ============================================================
   驗證
   ============================================================ */

function validateEntry_(input, settings) {
  if (!input || typeof input !== 'object') throw apiError_('invalid', '缺少明細資料');
  const date = String(input.date || '');
  if (!isValidDate_(date)) throw apiError_('invalid', '請選擇正確的日期');
  const payer = String(input.payer || '');
  if (settings.payers.indexOf(payer) < 0) throw apiError_('invalid', '請選擇誰付錢');
  const category = String(input.category || '');
  if (settings.categories.indexOf(category) < 0) throw apiError_('invalid', '請選擇分類');
  const name = String(input.name || '').trim();
  if (!name) throw apiError_('invalid', '請輸入名稱');
  if (Array.from(name).length > MAX_NAME) throw apiError_('invalid', '名稱最多 ' + MAX_NAME + ' 字');
  const amount = Number(input.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT) throw apiError_('invalid', '金額需為 1 到 999,999 的整數');
  return { date: date, payer: payer, category: category, name: name, amount: amount };
}

function assertUnlocked_(month) {
  const s = readSettlements_()[month];
  if (s && s.status === STATUS_SETTLED) throw apiError_('locked', month + ' 已結算');
}

function assertMonth_(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) throw apiError_('invalid', '月份格式錯誤');
}

function isValidDate_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const p = s.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2];
}

/* ============================================================
   讀寫工作表
   ============================================================ */

function readEntries_(fillMissingIds) {
  const sheet = sheet_(SHEET_ENTRIES);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const range = sheet.getRange(2, 1, lastRow - 1, ENTRY_HEADERS.length);
  const values = range.getValues();
  const tz = tz_();
  const out = [];
  const missing = [];
  values.forEach(function (r, i) {
    const date = normDate_(r[1], tz);
    const amount = Number(String(r[5]).replace(/[,\s]/g, ''));
    if (!date || !r[2] || !isFinite(amount) || r[5] === '') return; // 空白或不完整的列略過
    let id = String(r[0] || '').trim();
    if (!id) {
      id = Utilities.getUuid();
      missing.push({ row: i + 2, id: id });
    }
    out.push({
      row: i + 2,
      entry: {
        id: id,
        date: date,
        payer: String(r[2]).trim(),
        category: String(r[3]).trim() || '其他',
        name: String(r[4]).trim(),
        amount: Math.round(amount),
        createdAt: normTime_(r[6]),
        updatedAt: normTime_(r[7])
      }
    });
  });
  // PRD：Sheet 中缺少 id 的手動新增列，由系統自動補上 id
  if (fillMissingIds && missing.length) {
    withLock_(function () {
      missing.forEach(function (m) {
        if (!String(sheet.getRange(m.row, 1).getValue()).trim()) sheet.getRange(m.row, 1).setValue(m.id);
      });
    });
  }
  return out;
}

function findEntryRow_(id) {
  const rows = readEntries_(false);
  for (let i = 0; i < rows.length; i++) if (rows[i].entry.id === id) return rows[i];
  return null;
}

function readSettlements_() {
  const sheet = sheet_(SHEET_SETTLE);
  const lastRow = sheet.getLastRow();
  const out = {};
  if (lastRow < 2) return out;
  const tz = tz_();
  sheet.getRange(2, 1, lastRow - 1, SETTLE_HEADERS.length).getValues().forEach(function (r) {
    const month = normMonth_(r[0], tz);
    if (!month) return;
    out[month] = {
      month: month,
      status: String(r[1]).trim() === STATUS_SETTLED ? STATUS_SETTLED : STATUS_OPEN,
      total: r[2] === '' ? null : Number(r[2]),
      result: String(r[3] || ''),
      settledAt: normTime_(r[4]),
      operator: String(r[5] || '')
    };
  });
  return out;
}

function writeSettlement_(month, rowValues) {
  const sheet = sheet_(SHEET_SETTLE);
  const lastRow = sheet.getLastRow();
  const tz = tz_();
  let target = 0;
  if (lastRow >= 2) {
    const months = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < months.length; i++) {
      if (normMonth_(months[i][0], tz) === month) { target = i + 2; break; }
    }
  }
  if (!target) target = lastRow + 1;
  sheet.getRange(target, 1).setNumberFormat('@');
  sheet.getRange(target, 1, 1, SETTLE_HEADERS.length).setValues([rowValues]);
}

function readSettings_() {
  const sheet = sheet_(SHEET_SETTINGS);
  const lastRow = sheet.getLastRow();
  let payers = [];
  let categories = [];
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 2).getValues().forEach(function (r) {
      if (String(r[0]).trim()) payers.push(String(r[0]).trim());
      if (String(r[1]).trim()) categories.push(String(r[1]).trim());
    });
  }
  if (!payers.length) payers = DEFAULT_PAYERS.slice();
  if (!categories.length) categories = DEFAULT_CATEGORIES.slice();
  return { payers: payers, categories: categories };
}

/* ============================================================
   初始化：建立工作表（可重複執行，不會覆蓋既有資料）
   ============================================================ */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const entries = ensureSheet_(ss, SHEET_ENTRIES, ENTRY_HEADERS);
  entries.getRange('A:A').setNumberFormat('@');
  entries.getRange('B:B').setNumberFormat('yyyy-mm-dd');
  entries.getRange('F:F').setNumberFormat('#,##0');
  entries.getRange('G:H').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  entries.setColumnWidth(1, 280);
  entries.setColumnWidth(5, 200);

  const settings = ensureSheet_(ss, SHEET_SETTINGS, ['付款人', '分類']);
  if (settings.getLastRow() < 2) {
    const rows = [];
    for (let i = 0; i < Math.max(DEFAULT_PAYERS.length, DEFAULT_CATEGORIES.length); i++) {
      rows.push([DEFAULT_PAYERS[i] || '', DEFAULT_CATEGORIES[i] || '']);
    }
    settings.getRange(2, 1, rows.length, 2).setValues(rows);
  }

  const settle = ensureSheet_(ss, SHEET_SETTLE, SETTLE_HEADERS);
  settle.getRange('A:A').setNumberFormat('@');
  settle.getRange('C:C').setNumberFormat('#,##0');
  settle.getRange('E:E').setNumberFormat('yyyy-mm-dd hh:mm:ss');

  const sheet1 = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (sheet1 && sheet1.getLastRow() === 0 && ss.getSheets().length > 3) ss.deleteSheet(sheet1);

  console.log('設定完成：已建立「明細」「設定」「結算」工作表');
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#EEDDCC');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ============================================================
   工具
   ============================================================ */

function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw apiError_('not_configured', '找不到工作表「' + name + '」，請先執行 setup');
  return sh;
}

function tz_() { return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(); }

function normDate_(v, tz) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  const s = String(v || '').trim().replace(/\//g, '-');
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return '';
  const out = m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  return isValidDate_(out) ? out : '';
}

function normMonth_(v, tz) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, tz, 'yyyy-MM');
  const m = String(v || '').trim().replace(/\//g, '-').match(/^(\d{4})-(\d{1,2})/);
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) : '';
}

function normTime_(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString();
  return v ? String(v) : '';
}

function monthOf_(date) { return String(date).slice(0, 7); }

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw apiError_('busy');
  try { return fn(); } finally { lock.releaseLock(); }
}

function apiError_(code, message) {
  const err = new Error(message || code);
  err.apiCode = code;
  return err;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
