# 程式碼 Review 結果（2026-07-05）

Review 範圍：`src/game.js`、`src/main.jsx`、`src/progression.js`、`tile-art.js`、
`scripts/generate-solvable-boards.mjs`、`scripts/verify-solvable-boards.mjs`、
`scripts/dev-server.mjs`、`styles.css`、`index.html`、部署設定。

---

## 一、Bug

### BUG-1（中）：走了「合法但非正解」的一步後，提示功能永久失效
- 位置：`src/main.jsx` `showHint()` / `findRouteMove()` / `getAllowedRouteStepIndex()`
- 說明：有 routePlan 的關卡，提示只會在「目前群組尚未消耗的正解步」裡找。
  但實測發現 **33 個未啟用煙霧彈（smokeEnabled=false）的關卡開局就存在
  合法卻不在正解路線上的消除步**（例如同類型兩組牌交叉配對）。
  玩家走了這種步之後：
  - `routeStepIndex` 為 `null`，且因為煙霧彈未啟用，`routeState` 既不前進也不標記 broken；
  - 之後 `findRouteMove()` 因正解步的位置已被消掉而永遠找不到可走步，
    提示永遠回報「這局可能已經卡住」，即使棋盤實際上仍然可解。
- 驗證：以 node 腳本對全部 100 關重算 off-route 開局步，33/100 個非煙霧關卡中招；
  另外實測 `findSafeMove` 在最大 92 張牌棋盤（10-10）僅需約 14ms，fallback 無效能疑慮。
- 修復：`showHint()` 在路線提示找不到、且路線未被煙霧彈標記 broken 時，
  fallback 改用 `findSafeMove()`（會驗證消除後仍可解）。煙霧彈 broken 的行為維持原設計。
- 狀態：**已修復**

### BUG-2（中）：dev-server 路徑遍歷防護不足 + 畸形 URL 會使伺服器崩潰
- 位置：`scripts/dev-server.mjs` `safePathFromUrl()`
- 說明：
  1. `fullPath.startsWith(rootDir)` 沒有加路徑分隔符，`D:\Game\SichuanP-secret\...`
     這類 sibling 目錄也會通過檢查。
  2. `new URL()` / `decodeURIComponent()`（例如請求 `/%`）會丟出例外，
     而呼叫端沒有 try/catch，在 async handler 內形成 unhandled rejection，
     新版 Node 預設會讓整個行程崩潰。
- 修復：改為 `fullPath === rootDir || fullPath.startsWith(rootDir + path.sep)`，
  並將解析包進 try/catch，失敗回傳 403。
- 狀態：**已修復**

### BUG-3（低）：管理面板連結在 GitHub Pages 部署下必定 404
- 位置：`src/main.jsx` `AdminPanel` 的 `<a href="/local-admin/">`
- 說明：GitHub Pages 以 `--base=/sichuanp/` 部署（見 `.github/workflows/pages.yml`），
  絕對路徑 `/local-admin/` 會指到網站根目錄而 404（`local-admin/` 也未部署）。
- 修復：改用 `import.meta.env.BASE_URL` 組出相對於部署根的路徑。
- 狀態：**已修復**

### BUG-4（低）：在 setState updater 內執行 localStorage 副作用
- 位置：`src/main.jsx` `ensureWinState()`（由 `scheduleRemoval` 的
  `setGame((current) => …)` updater 呼叫）
- 說明：React 要求 updater 為純函式；在 StrictMode／併發模式下 updater 可能被
  重複執行，`saveStageNumber` / `saveCompletedStageNumber` 會被寫入多次。
  目前寫入是冪等的（取 max），實害低，但屬於錯誤模式。
- 修復：`ensureWinState()` 改為純函式，儲存邏輯移到 `useGame` 的
  `useEffect`（在 `game.won` 變 true 時執行一次）。
- 狀態：**已修復**

### BUG-5（低，資料面 known issue）：驗證腳本沒有抓到 BUG-1 的資料根源
- 位置：`scripts/verify-solvable-boards.mjs`、`scripts/generate-solvable-boards.mjs`
- 說明：對 smokeEnabled=false 的關卡，產生器不計算 smoke 指標（直接填 0），
  驗證腳本也只驗「記錄值等於 0」，並未重算。因此「設計上宣稱無岔路的關卡
  實際上有岔路」這件事從未被偵測。真正修掉需要調整生成條件並重新生成全部
  100 關（牌面資料會全部改變，玩家體感也會變），成本與風險高。
- 處置：以 BUG-1 的 runtime fallback 緩解；此項列為 known issue，
  未來若重新生成關卡資料時再一併處理。
- 狀態：**暫不修復（已由 BUG-1 緩解）**

---

## 二、重構建議

### REF-1：`getStageRecord` 每次載入關卡都對 100 筆資料排序
- 位置：`src/game.js`
- 說明：每次建立棋盤都 `[...SOLVABLE_BOARDS].sort(...)` 再用索引取值；
  資料本身已有唯一的 `stage.number`（verify 腳本保證 1–100 不重複），
  直接用 `find` 查找即可，語意也更清楚。
- 狀態：**已重構**

### REF-2：移除死程式碼與未使用檔案
- `src/game.js`：`getBoardPositions()` 未被任何地方使用。
- `src/game.js`：`createPlayableBoard()` export 未被任何地方 import（`main.jsx` 用的是
  `createPlayableBoardRecord`）。
- `scripts/generate-solvable-boards.mjs`：`countSolutionRoutes()` 定義後從未呼叫。
- 根目錄 `mahjong-match.css`：整個專案沒有任何檔案引用它。
- 狀態：**已移除**

### REF-3：生成腳本與驗證腳本大量重複邏輯
- 位置：`scripts/generate-solvable-boards.mjs`、`scripts/verify-solvable-boards.mjs`
- 說明：`ROUTE_LIMIT_BY_SUBSTAGE`、`getSmokeStartStage`、`factorial`、
  `samePosition` / `sameMove` / `sameRouteStep`、`calculateSmokeMetrics`
  兩份完全重複，改動規則時容易只改到一邊（BUG-5 正是這類風險的例子）。
- 修復：抽出共用模組 `scripts/route-metrics.mjs`，兩支腳本共同引用。
- 狀態：**已重構**（以重新生成結果與既有資料 byte-identical 驗證）

### REF-4：生成腳本九個幾乎相同的 `applyWorldXxx` 函式與巢狀呼叫金字塔
- 位置：`scripts/generate-solvable-boards.mjs`
- 說明：`applyWorldOneFrameBoards`（實際作用於 world 5）、
  `applyWorldNineLayeredBoards`（實際作用於 world 3）……九個函式除了
  world 編號、shape 名稱、mask 之外完全相同，且函式名稱和實際 world 對不上，
  main() 內還有 9 層巢狀呼叫。改為設定表（保持原本的套用順序，
  確保隨機數流不變）+ 單一迴圈。
- 狀態：**已重構**（以重新生成結果與既有資料 byte-identical 驗證）

### REF-5：勝利文案硬編碼「100 關」「10-10」
- 位置：`src/main.jsx` `ensureWinState()`、`StagePrompt`
- 說明：「第 10-10 關通過！全部關卡完成。」「恭喜完成 100 關」為硬編碼，
  若調整 `TOTAL_WORLDS` / `STAGES_PER_WORLD` 會顯示錯誤文案。
  改由 `stageInfo.label` 與 `TOTAL_STAGES` 導出。
- 狀態：**已重構**

### REF-6（建議，未動）：事件處理器使用非函數式 setState
- 位置：`src/main.jsx` `useGame` 內多數 handler（`setGame({ ...game, ... })`）
- 說明：handler 從 render 時的 closure 讀 `game`，理論上有 stale state 風險。
  目前所有輸入在動畫期間都被擋住（`removing.length > 0` guard），
  timer 回呼也已用函數式 updater 並比對 `removing`，實務上安全。
  全面改寫需把配對邏輯搬進 updater，改動面大、收益低，暫不處理。
- 狀態：**不修改（附註原因）**

### REF-7（建議，未動）：`role="grid"` 的 ARIA 結構不完整
- 位置：`src/main.jsx` `Board`
- 說明：`role="grid"` 底下應有 `role="row"` / `role="gridcell"` 結構，
  目前直接放 button。螢幕報讀仍可運作（每顆 button 有完整 aria-label），
  屬次要無障礙議題，可日後與 UI 調整一併處理。
- 狀態：**不修改（附註原因）**
