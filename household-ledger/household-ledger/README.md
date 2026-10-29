# 家用收支簿

牧與虎的家用支出記帳網站：手機記帳、每月明細與分類圖表、自動算出多退少補、月結算與鎖定。資料存放在 Google Sheet。

- 前端：純靜態網頁（HTML / CSS / JS），放在 GitHub Pages
- 後端：Google Apps Script（綁定 Google Sheet），需輸入家庭密碼才能存取

```
household-ledger/
├─ index.html            網站入口
├─ styles.css            樣式（大地色系）
├─ app.js                網站程式
├─ config.js             ← 部署時要填的 API 網址
├─ manifest.webmanifest  加到手機主畫面用
├─ icons/                App 圖示
├─ .nojekyll             讓 GitHub Pages 原樣提供檔案
└─ apps-script/Code.gs   ← 貼到 Google Sheet 的 Apps Script
```

---

## 先試用（不用任何設定）

`config.js` 的 `API_URL` 空白時會進入**示範模式**：附範例資料，所有功能都能操作，資料只存在該瀏覽器。
把整個資料夾推上 GitHub Pages（見步驟 5）就能用手機先看看，確定沒問題再接上 Google Sheet。

本機預覽：在資料夾內執行 `python3 -m http.server 8000`，開 http://localhost:8000 。

---

## 正式上線：4 個步驟（約 15 分鐘）

> 以下皆用**擁有者**（建立 Sheet 的那位）的 Google 帳號操作。

### 步驟 1：建立 Google Sheet 與 API

1. 到 [Google 試算表](https://sheets.new) 建立新試算表，命名為「家用收支簿」。
2. 在試算表選單點 **擴充功能 → Apps Script**（一定要從試算表裡開啟）。
3. 刪掉編輯器裡的全部內容（包含預設的 `function myFunction() {}`），貼上 `apps-script/Code.gs` 的全部內容，按 **儲存**。
4. 上方「執行」右邊的函式下拉選單選 **`setup`**（存檔後才會出現；預設會停在 `doGet`，要手動改）→ 按 **執行**。
5. 第一次會跳出授權：選帳號 →「進階」→「前往（不安全）」→「允許」。授權完成後**再按一次執行**（第一次只會跑完授權）。
6. 下方執行記錄出現「設定完成」，回到試算表就會看到三個工作表：**明細**、**設定**、**結算**。

### 步驟 2：設定家庭密碼並部署 API

1. Apps Script 編輯器左側齒輪 **專案設定** → 最下方 **指令碼屬性** → **新增指令碼屬性**：

   | 屬性 | 值 |
   |---|---|
   | `LEDGER_PASSCODE` | 自訂的家庭密碼（建議 8 個字元以上，不要和其他帳號共用） |

2. 右上角 **部署 → 新增部署作業** → 齒輪選 **網頁應用程式**：
   - 執行身分：**我**
   - 誰可以存取：**任何人**
3. 按部署 → 複製 **網頁應用程式網址**（結尾是 `/exec`）。

> 為什麼選「任何人」？這樣網站才能從 GitHub Pages 連進來。實際的把關在程式裡：每個請求都會比對家庭密碼，不正確一律拒絕；連續輸錯 10 次會暫停 10 分鐘。Sheet 本身不需要公開分享。

### 步驟 3：填寫 config.js

```js
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/xxxxxxxx/exec'
};
```

家庭密碼**不要**寫進 config.js，它只存在 Apps Script 的指令碼屬性裡。

### 步驟 4：部署到 GitHub Pages

1. 在 GitHub 建立新 repository（例如 `household-ledger`），把本資料夾所有檔案上傳到根目錄（含 `.nojekyll`）。
2. repo 的 **Settings → Pages** → Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾 `/ (root)` → Save。
3. 約 1 分鐘後網址會出現：`https://你的GitHub帳號.github.io/household-ledger/`
4. 打開網址，輸入家庭密碼、選「我是牧／虎」即可進入。這台裝置會記住，下次不用再輸入。

### 加到手機主畫面

- iPhone（Safari）：分享按鈕 → **加入主畫面**
- Android（Chrome）：右上角選單 → **加到主畫面**

---

## 分享給另一位家長

1. 把網站網址和家庭密碼傳給對方，對方第一次開啟時輸入密碼並選自己的名字。
2. （選擇性）把 Google Sheet **共用**給對方，方便直接在 Sheet 查看或整理。

## 更換家庭密碼

到 Apps Script **專案設定 → 指令碼屬性** 修改 `LEDGER_PASSCODE` 即可，不需要重新部署。兩人的裝置下次操作時會被要求輸入新密碼。

---

## 日常使用說明

- **同步方式**：網站送出即寫入 Sheet；在 Sheet 手動修改後，網站按右上角 ↻ 或重新整理即可看到。
- **在 Sheet 手動新增一列**：填日期、付款人、分類、名稱、金額即可，`id` 留空，網站下次讀取時會自動補上。
- **已結算月份**：網站會鎖定，無法新增、修改、刪除；請勿直接在 Sheet 修改已結算月份（若有變動，網站會在該月份顯示提醒，建議取消結算後重新結算）。
- **誤刪資料**：Sheet 選單 **檔案 → 版本記錄** 可還原。
- **修改分類或付款人**：在「設定」工作表調整（新分類會用預設圖示）。

## 之後要更新 Apps Script 程式

編輯 `Code.gs` 後：**部署 → 管理部署作業** → 鉛筆圖示 → 版本選 **新版本** → 部署。網址不變，網站不用改。

## 常見問題

| 狀況 | 處理方式 |
|---|---|
| 執行時出現 `window is not defined` | 貼錯檔案了，Apps Script 只貼 `apps-script/Code.gs` |
| 執行後沒有出現三個工作表 | 函式選單要選 `setup`（不是 `doGet` 或 `myFunction`），授權後要再按一次執行 |
| 一直顯示「密碼不正確」 | 確認指令碼屬性名稱是 `LEDGER_PASSCODE`，且值沒有多餘空白 |
| 顯示「伺服器回應異常」 | `API_URL` 要用結尾 `/exec` 的網址，且部署時存取權選「任何人」 |
| 顯示「Apps Script 尚未完成設定」 | 還沒新增 `LEDGER_PASSCODE` 指令碼屬性 |
| 改了 Code.gs 沒生效 | 需要「管理部署作業 → 編輯 → 版本選新版本 → 部署」，只按儲存不會更新線上版本 |
| 想切換「我是誰」或登出 | 首頁右上角的名字圓圈 |
