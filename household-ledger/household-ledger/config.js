/*
 * 家用收支簿 — 連線設定
 * ------------------------------------------------------------
 * API_URL 留空 → 「示範模式」：資料只存在這台裝置的瀏覽器，方便先試用。
 * API_URL 填好 → 正式模式：輸入家庭密碼後，資料讀寫 Google Sheet。
 *
 * 填法請見 README.md 的「步驟 2」。家庭密碼不寫在這裡，而是設定在 Apps Script。
 */
window.APP_CONFIG = {
  // Apps Script「網頁應用程式」部署後拿到的網址，結尾是 /exec
  API_URL: 'https://script.google.com/macros/s/AKfycbyXTBhRUv__fq5yG_xn-BLB5g3GzOYJ66T3A8turQVx6BFQX238AqpQNRlVyIwZAR7gaw/exec'
};
