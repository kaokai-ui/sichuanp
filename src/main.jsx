import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { getTileBackSvgMarkup, getTileSvgMarkup } from "../tile-art.js";
import {
  analyzePair,
  countRemainingPairs,
  countRemainingTiles,
  createPlayableBoardRecord,
  findMoves,
  getBoardDimensions,
  isBoardSolvable,
  isTileOpen,
  removePair,
} from "./game.js";
import {
  clampStageNumber,
  getNextStageNumber,
  getStageInfo,
  readCompletedStageNumber,
  readSavedStageNumber,
  saveCompletedStageNumber,
  saveStageNumber,
  STAGES_PER_WORLD,
  TOTAL_STAGES,
} from "./progression.js";
import "../styles.css";

const REMOVE_ANIMATION_MS = 260;
const TILE_RATIO = 0.727;
const MAX_TILE_SIZE = 104;
const MIN_TILE_SIZE = 16;
const TILE_GAP_RATIO = 0.07;
const TILE_PADDING_RATIO = 0.11;
const MIN_TILE_GAP = 5;
const MIN_BOARD_PADDING = 9;
const LANDSCAPE_NAMES = [
  "海岸晨光",
  "雪山湖泊",
  "花田丘陵",
  "沙漠峽谷",
  "竹林溪谷",
  "極光冰原",
  "秋林山徑",
  "熱帶瀑布",
  "高原星河",
  "島嶼夕陽",
];

const LANDSCAPE_POSITIONS = [
  "center",
  "center",
  "center",
  "center",
  "38% center",
  "center",
  "center",
  "center",
  "center",
  "center",
];

const ASSET_BASE_URL = import.meta.env.BASE_URL;

const LANDSCAPE_REGIONS = Array.from({ length: STAGES_PER_WORLD }, (_, index) => {
  const col = index % 5;
  const row = Math.floor(index / 5);
  const x0 = col * 20;
  const x1 = x0 + 20;
  const y0 = row * 50;
  const y1 = y0 + 50;

  return {
    id: index + 1,
    clipPath: `polygon(${x0}% ${y0}%, ${x1}% ${y0}%, ${x1}% ${y1}%, ${x0}% ${y1}%)`,
  };
});

function getBoardPixelSize(tileSize, rows, cols) {
  const gap = Math.max(MIN_TILE_GAP, tileSize * TILE_GAP_RATIO);
  const padding = Math.max(MIN_BOARD_PADDING, tileSize * TILE_PADDING_RATIO);

  return {
    width: cols * tileSize + Math.max(0, cols - 1) * gap + padding * 2,
    height: rows * (tileSize / TILE_RATIO) + Math.max(0, rows - 1) * gap + padding * 2,
  };
}

function calculateTileSize(containerSize, rows, cols) {
  const availableWidth = containerSize.width;
  const availableHeight = containerSize.height;

  if (!availableWidth || !availableHeight || rows <= 0 || cols <= 0) {
    return null;
  }

  let low = MIN_TILE_SIZE;
  let high = Math.min(
    MAX_TILE_SIZE,
    availableWidth / cols,
    (availableHeight * TILE_RATIO) / rows,
  );

  for (let index = 0; index < 24; index += 1) {
    const tileSize = (low + high) / 2;
    const boardSize = getBoardPixelSize(tileSize, rows, cols);

    if (boardSize.width <= availableWidth && boardSize.height <= availableHeight) {
      low = tileSize;
    } else {
      high = tileSize;
    }
  }

  return Math.max(MIN_TILE_SIZE, Math.floor(low));
}

function useElementSize() {
  const elementRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = elementRef.current;

    if (!element) {
      return undefined;
    }

    function updateSize() {
      const rect = element.getBoundingClientRect();
      setSize({
        width: Math.max(0, rect.width),
        height: Math.max(0, rect.height),
      });
    }

    updateSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return [elementRef, size];
}

function readAdminMode() {
  try {
    const params = new URLSearchParams(globalThis.location?.search ?? "");
    const storage = globalThis.localStorage;

    if (params.get("admin") === "1") {
      storage?.setItem("sichuanp.adminMode", "1");
      return true;
    }

    if (params.get("admin") === "0") {
      storage?.removeItem("sichuanp.adminMode");
      return false;
    }

    return storage?.getItem("sichuanp.adminMode") === "1";
  } catch {
    return false;
  }
}

function readRequestedStageNumber(isAdminMode) {
  if (!isAdminMode) {
    return readSavedStageNumber();
  }

  try {
    const params = new URLSearchParams(globalThis.location?.search ?? "");
    return params.has("stage")
      ? clampStageNumber(params.get("stage"))
      : readSavedStageNumber();
  } catch {
    return readSavedStageNumber();
  }
}

function readLandscapePreviewMode(isAdminMode) {
  if (!isAdminMode) {
    return false;
  }

  try {
    const params = new URLSearchParams(globalThis.location?.search ?? "");
    return params.get("previewWorld") === "1";
  } catch {
    return false;
  }
}

function getStageLandscape(stageInfo) {
  const name = LANDSCAPE_NAMES[(stageInfo.world - 1) % LANDSCAPE_NAMES.length];
  const world = String(stageInfo.world).padStart(2, "0");

  return {
    name,
    image: `url("${ASSET_BASE_URL}landscapes/world-${world}.png")`,
    position: LANDSCAPE_POSITIONS[(stageInfo.world - 1) % LANDSCAPE_POSITIONS.length],
  };
}

function getLandscapeRevealCount(game) {
  const worldStart = (game.stageInfo.world - 1) * STAGES_PER_WORLD;
  const completedInWorld = (game.completedStageNumber ?? 0) - worldStart;

  return Math.min(STAGES_PER_WORLD, Math.max(0, completedInWorld));
}

function canHideMahjongForCompletedWorld(game) {
  return (
    game.stageInfo.stage === STAGES_PER_WORLD &&
    (game.completedStageNumber ?? 0) >= game.stageInfo.world * STAGES_PER_WORLD
  );
}

function createInitialGame(stageNumber = null, statusText = null, options = {}) {
  const isAdminMode = options.isAdminMode ?? readAdminMode();
  const stageInfo = getStageInfo(
    stageNumber ?? readRequestedStageNumber(isAdminMode),
  );
  const landscapePreviewMode =
    options.landscapePreviewMode ?? readLandscapePreviewMode(isAdminMode);
  const storedCompletedStageNumber = readCompletedStageNumber();
  const completedStageNumber = landscapePreviewMode
    ? Math.max(
        storedCompletedStageNumber,
        Math.min(TOTAL_STAGES, stageInfo.world * STAGES_PER_WORLD),
      )
    : storedCompletedStageNumber;
  const playableBoard = createPlayableBoardRecord(
    Math.random,
    null,
    stageInfo.number,
  );

  if (!isAdminMode) {
    saveStageNumber(stageInfo.number);
  }

  return {
    board: playableBoard.board,
    boardRecord: playableBoard.record,
    stageInfo,
    nextStageNumber: null,
    selected: null,
    hint: [],
    removing: [],
    clearedPairs: 0,
    totalPairs: countRemainingPairs(playableBoard.board),
    routeState: createInitialRouteState(playableBoard.record),
    completedStageNumber,
    isAdminMode,
    landscapePreviewMode,
    mahjongHidden: false,
    awaitingContinue: false,
    statusText:
      statusText ??
      (landscapePreviewMode
        ? `第 ${stageInfo.world} 大關通關彩色照片預覽：背景已完整解鎖。`
        : `第 ${stageInfo.label} 關開始，難度 ${stageInfo.difficulty}/100。`),
    won: false,
  };
}

function samePosition(left, right) {
  return left?.row === right?.row && left?.col === right?.col;
}

function getRoutePlan(record) {
  return Array.isArray(record?.routePlan) ? record.routePlan : [];
}

function createInitialRouteState(record) {
  const routePlan = getRoutePlan(record);
  const routeGroupSizes = Array.isArray(record?.routeGroupSizes)
    ? record.routeGroupSizes.filter((size) => Number.isInteger(size) && size > 0)
    : [];

  if (routePlan.length === 0 || routeGroupSizes.length === 0) {
    return null;
  }

  return {
    groupIndex: 0,
    groupStart: 0,
    consumed: [],
  };
}

function hasRoutePolicy(game) {
  return Boolean(
    game.routeState &&
      getRoutePlan(game.boardRecord).length > 0 &&
      Array.isArray(game.boardRecord?.routeGroupSizes),
  );
}

function isSmokeEnabled(game) {
  return game.boardRecord?.metrics?.smokeEnabled === true;
}

function sameRouteStep(step, first, second, type) {
  if (!step || step.type !== type) {
    return false;
  }

  return (
    (samePosition(step.first, first) && samePosition(step.second, second)) ||
    (samePosition(step.first, second) && samePosition(step.second, first))
  );
}

function getCurrentRouteGroupBounds(game) {
  const routeGroupSizes = game.boardRecord?.routeGroupSizes ?? [];
  const size = routeGroupSizes[game.routeState.groupIndex] ?? 0;
  const start = game.routeState.groupStart;

  return {
    start,
    end: Math.min(getRoutePlan(game.boardRecord).length, start + size),
  };
}

function getAllowedRouteStepIndex(game, first, second, type) {
  if (!hasRoutePolicy(game)) {
    return null;
  }

  const routePlan = getRoutePlan(game.boardRecord);
  const { start, end } = getCurrentRouteGroupBounds(game);
  const consumed = new Set(game.routeState.consumed);

  for (let index = start; index < end; index += 1) {
    if (consumed.has(index)) {
      continue;
    }

    if (sameRouteStep(routePlan[index], first, second, type)) {
      return index;
    }
  }

  return null;
}

function advanceRouteState(game, consumedStepIndex) {
  if (!hasRoutePolicy(game) || consumedStepIndex === null) {
    return game.routeState;
  }

  const routeGroupSizes = game.boardRecord.routeGroupSizes;
  const { start, end } = getCurrentRouteGroupBounds(game);
  const consumed = [...game.routeState.consumed, consumedStepIndex].filter(
    (stepIndex) => stepIndex >= start && stepIndex < end,
  );

  if (consumed.length < end - start) {
    return {
      ...game.routeState,
      consumed,
    };
  }

  return {
    groupIndex: game.routeState.groupIndex + 1,
    groupStart: end,
    consumed: [],
    done: end >= getRoutePlan(game.boardRecord).length,
    broken: game.routeState.broken,
    totalGroups: routeGroupSizes.length,
  };
}

function markRouteBroken(game) {
  if (!hasRoutePolicy(game)) {
    return game.routeState;
  }

  return {
    ...game.routeState,
    broken: true,
  };
}

function findRouteMove(game) {
  if (!hasRoutePolicy(game)) {
    return null;
  }

  const routePlan = getRoutePlan(game.boardRecord);
  const { start, end } = getCurrentRouteGroupBounds(game);
  const consumed = new Set(game.routeState.consumed);

  for (let index = start; index < end; index += 1) {
    const step = routePlan[index];

    if (consumed.has(index)) {
      continue;
    }

    const result = analyzePair(game.board, step.first, step.second);

    if (result.ok && result.tile.type === step.type) {
      return {
        first: step.first,
        second: step.second,
      };
    }
  }

  return null;
}

function describeFailure(reason) {
  switch (reason) {
    case "path-blocked":
      return "這兩張牌沒有辦法在兩個折角內連起來。";
    case "first-tile-blocked":
    case "second-tile-blocked":
      return "被選的牌至少都要有一邊臨空。";
    default:
      return "這組牌現在不能消除。";
  }
}

function formatDifficulty(stageInfo) {
  if (!Number.isFinite(stageInfo?.difficulty)) {
    return "未評分";
  }

  return `${stageInfo.difficulty}/100`;
}

function describePosition(position) {
  return `${position.row + 1}排${position.col + 1}列`;
}

function findSafeMove(board) {
  for (const move of findMoves(board)) {
    const nextBoard = removePair(board, move.first, move.second);

    if (countRemainingTiles(nextBoard) === 0 || isBoardSolvable(nextBoard)) {
      return move;
    }
  }

  return null;
}

function ensureWinState(nextState) {
  const remainingTiles = countRemainingTiles(nextState.board);

  if (remainingTiles === 0) {
    const nextStageNumber = getNextStageNumber(nextState.stageInfo.number);
    const completedStageNumber = Math.max(
      nextState.completedStageNumber ?? 0,
      nextState.stageInfo.number,
    );

    if (nextStageNumber && !nextState.isAdminMode) {
      saveStageNumber(nextStageNumber);
    }

    if (!nextState.isAdminMode) {
      saveCompletedStageNumber(nextState.stageInfo.number);
    }

    return {
      ...nextState,
      completedStageNumber,
      won: true,
      awaitingContinue: true,
      nextStageNumber,
      selected: null,
      hint: [],
      statusText: nextStageNumber
        ? `第 ${nextState.stageInfo.label} 關通過！要繼續下一關嗎？`
        : "第 10-10 關通過！全部關卡完成。",
    };
  }

  return nextState;
}

function useGame() {
  const [game, setGame] = useState(createInitialGame);
  const removeTimerRef = useRef(null);

  function clearRemoveTimer() {
    if (removeTimerRef.current) {
      window.clearTimeout(removeTimerRef.current);
      removeTimerRef.current = null;
    }
  }

  useEffect(() => clearRemoveTimer, []);

  function restart() {
    clearRemoveTimer();
    setGame(
      createInitialGame(
        game.stageInfo.number,
        `第 ${game.stageInfo.label} 關已重新開始。`,
        { isAdminMode: game.isAdminMode },
      ),
    );
  }

  function continueGame() {
    if (!game.nextStageNumber) {
      return;
    }

    clearRemoveTimer();
    const nextStageInfo = getStageInfo(game.nextStageNumber);
    setGame(
      createInitialGame(
        nextStageInfo.number,
        `進入第 ${nextStageInfo.label} 關，難度 ${nextStageInfo.difficulty}/100。`,
        { isAdminMode: game.isAdminMode },
      ),
    );
  }

  function restartFromFirstStage() {
    clearRemoveTimer();
    setGame(createInitialGame(1, "已回到第 1-1 關。", { isAdminMode: game.isAdminMode }));
  }

  function selectStage(stageNumber) {
    const stageInfo = getStageInfo(stageNumber);

    clearRemoveTimer();
    setGame(
      createInitialGame(
        stageInfo.number,
        `測試第 ${stageInfo.label} 關，難度 ${stageInfo.difficulty}/100。`,
        { isAdminMode: game.isAdminMode },
      ),
    );
  }

  function toggleMahjongVisibility() {
    if (!canHideMahjongForCompletedWorld(game)) {
      return;
    }

    const nextHidden = !game.mahjongHidden;

    setGame({
      ...game,
      hint: [],
      selected: null,
      mahjongHidden: nextHidden,
      statusText: nextHidden
        ? `已隱藏第 ${game.stageInfo.world} 大關的麻將，可以查看完整通關照片。`
        : "已重新顯示麻將。",
    });
  }

  function scheduleRemoval({
    positions,
    nextBoard,
    nextClearedPairs,
    nextRouteState,
    isSmokeMove,
    tileLabel,
  }) {
    clearRemoveTimer();
    removeTimerRef.current = window.setTimeout(() => {
      setGame((current) => {
        const isSameRemoval =
          current.removing.length === positions.length &&
          positions.every((position, index) =>
            samePosition(position, current.removing[index]),
          );

        if (!isSameRemoval) {
          return current;
        }

        return ensureWinState({
          ...current,
          board: nextBoard,
          hint: [],
          removing: [],
          clearedPairs: nextClearedPairs,
          routeState: nextRouteState,
          statusText: isSmokeMove
            ? `煙霧彈配對：${tileLabel} 已消除。後續可能卡住，可按提示嘗試回到正解。`
            : `配對成功：${tileLabel}。`,
        });
      });
      removeTimerRef.current = null;
    }, REMOVE_ANIMATION_MS);
  }

  function showHint() {
    if (game.won || game.awaitingContinue || game.removing.length > 0) {
      return;
    }

    const move = hasRoutePolicy(game) ? findRouteMove(game) : findSafeMove(game.board);

    if (!move) {
      setGame({
        ...game,
        hint: [],
        statusText: game.routeState?.broken
          ? "正解路線已被煙霧彈破壞，這局可能已經卡住，建議重玩本關。"
          : hasRoutePolicy(game)
          ? "目前找不到符合本關指定順序的可消除牌，這局可能已經卡住。"
          : "目前找不到可安全消除的牌，這局可能已經卡住。",
      });
      return;
    }

    const tile = game.board[move.first.row][move.first.col];
    setGame({
      ...game,
      hint: [move.first, move.second],
      statusText: `提示：可消除 ${tile.label}（${describePosition(move.first)}、${describePosition(move.second)}）。`,
    });
  }

  function selectTile(position) {
    if (game.won || game.awaitingContinue || game.removing.length > 0) {
      return;
    }

    const tile = game.board[position.row]?.[position.col];

    if (!tile) {
      return;
    }

    if (!game.selected) {
      setGame({
        ...game,
        selected: position,
        hint: [],
        statusText: `已選取 ${tile.label}。`,
      });
      return;
    }

    if (samePosition(game.selected, position)) {
      setGame({
        ...game,
        selected: null,
        hint: [],
        statusText: "已取消選取。",
      });
      return;
    }

    const selectedTile = game.board[game.selected.row][game.selected.col];

    if (selectedTile.type !== tile.type) {
      setGame({
        ...game,
        selected: position,
        hint: [],
        statusText: `已改選 ${tile.label}。`,
      });
      return;
    }

    const result = analyzePair(game.board, game.selected, position);

    if (!result.ok) {
      setGame({
        ...game,
        hint: [],
        statusText: describeFailure(result.reason),
      });
      return;
    }

    const routeStepIndex = getAllowedRouteStepIndex(
      game,
      game.selected,
      position,
      result.tile.type,
    );

    const isSmokeMove = hasRoutePolicy(game) && routeStepIndex === null && isSmokeEnabled(game);

    const nextBoard = removePair(game.board, game.selected, position);

    const removing = [game.selected, position];
    const nextClearedPairs = game.clearedPairs + 1;
    const nextRouteState = isSmokeMove
      ? markRouteBroken(game)
      : advanceRouteState(game, routeStepIndex);

    setGame({
      ...game,
      selected: null,
      hint: [],
      removing,
      routeState: nextRouteState,
      statusText: isSmokeMove
        ? `煙霧彈配對：${result.tile.label} 正在消除，這一步偏離本關正解。`
        : `配對成功：${result.tile.label} 正在消除。`,
    });

    scheduleRemoval({
      positions: removing,
      nextBoard,
      nextClearedPairs,
      nextRouteState,
      isSmokeMove,
      tileLabel: result.tile.label,
    });
  }

  return {
    continueGame,
    game,
    restart,
    restartFromFirstStage,
    selectStage,
    selectTile,
    showHint,
    toggleMahjongVisibility,
  };
}

function MahjongTile({
  board,
  tile,
  row,
  col,
  selected,
  hint,
  removing,
  won,
  onSelect,
}) {
  const isCovered = Boolean(tile?.covered);
  const open = tile && !isCovered ? isTileOpen(board, row, col) : false;
  const isSelected = selected && samePosition(selected, { row, col });
  const isHinted = hint.some((position) => samePosition(position, { row, col }));
  const isRemoving = removing.some((position) => samePosition(position, { row, col }));
  const isStacked = Boolean(tile?.under);
  const svgMarkup = useMemo(
    () => (tile ? (isCovered ? getTileBackSvgMarkup() : getTileSvgMarkup(tile.type)) : ""),
    [isCovered, tile],
  );

  if (!tile) {
    return <div className="tile-slot tile-slot--empty" aria-hidden="true" />;
  }

  return (
    <button
      type="button"
      className={[
        "tile-button",
        open ? "tile-button--open" : "tile-button--blocked",
        isStacked ? "tile-button--stacked" : "",
        isCovered ? "tile-button--covered" : "",
        isSelected ? "tile-button--selected" : "",
        isHinted ? "tile-button--hint" : "",
        isRemoving ? "tile-button--removing" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={won || isRemoving || removing.length > 0 || !open}
      onClick={() => onSelect({ row, col })}
      aria-label={`${row + 1} 排 ${col + 1} 列，${isCovered ? "下層牌背" : tile.label}${
        isRemoving ? "，正在消除" : ""
      }${isStacked ? "，下層還有牌" : ""}${isHinted ? "，提示牌" : ""}`}
    >
      <span
        className="tile-art"
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
      />
    </button>
  );
}

function Board({ game, onSelect }) {
  const { rows, cols } = getBoardDimensions(game.board);
  const [boardWrapRef, boardWrapSize] = useElementSize();
  const measuredTileSize = calculateTileSize(boardWrapSize, rows, cols);

  return (
    <div className="board-wrap" ref={boardWrapRef}>
      <div
        className="board"
        role="grid"
        aria-label={`四川麻將 ${rows} 乘 ${cols} 牌盤`}
        style={{
          "--board-rows": rows,
          "--board-cols": cols,
          "--board-width-factor": cols + Math.max(0, cols - 1) * TILE_GAP_RATIO + TILE_PADDING_RATIO * 2,
          "--board-height-factor":
            rows / TILE_RATIO + Math.max(0, rows - 1) * TILE_GAP_RATIO + TILE_PADDING_RATIO * 2,
          "--tile-size": measuredTileSize
            ? `${measuredTileSize}px`
            : undefined,
        }}
      >
        {game.board.map((rowTiles, row) =>
          rowTiles.map((tile, col) => (
            <MahjongTile
              key={`${row}-${col}`}
              board={game.board}
              tile={tile}
              row={row}
              col={col}
              selected={game.selected}
              hint={game.hint}
              removing={game.removing}
              won={game.won}
              onSelect={onSelect}
            />
          )),
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StagePrompt({ game, onContinue, onRestartFromFirst }) {
  if (!game.awaitingContinue) {
    return null;
  }

  if (!game.nextStageNumber) {
    return (
      <div className="stage-prompt" role="status" aria-live="polite">
        <strong>恭喜完成 100 關</strong>
        <p>目前所有關卡都已通過，可以回到第 1-1 關重新挑戰。</p>
        <button type="button" className="continue-button" onClick={onRestartFromFirst}>
          回到第一關
        </button>
      </div>
    );
  }

  const nextStageInfo = getStageInfo(game.nextStageNumber);

  return (
    <div className="stage-prompt" role="status" aria-live="polite">
      <strong>第 {game.stageInfo.label} 關通過</strong>
      <p>要繼續挑戰第 {nextStageInfo.label} 關嗎？</p>
      <button type="button" className="continue-button" onClick={onContinue}>
        繼續遊戲
      </button>
    </div>
  );
}

function AdminPanel({ game, onSelectStage }) {
  if (!game.isAdminMode) {
    return null;
  }

  return (
    <div className="admin-panel" aria-label="管理測試選單">
      <label>
        測試關卡
        <select
          className="stage-select"
          value={game.stageInfo.number}
          onChange={(event) => onSelectStage(event.target.value)}
        >
          {Array.from({ length: TOTAL_STAGES }, (_, index) => {
            const stageInfo = getStageInfo(index + 1);
            return (
              <option key={stageInfo.number} value={stageInfo.number}>
                {stageInfo.label} - 難度 {stageInfo.difficulty}/100
              </option>
            );
          })}
        </select>
      </label>
      <a href="/local-admin/">開啟管理介面</a>
    </div>
  );
}

function Sidebar({
  game,
  onContinue,
  onRestart,
  onRestartFromFirst,
  onSelectStage,
  onShowHint,
  onToggleMahjongVisibility,
}) {
  const remainingPairs = countRemainingPairs(game.board);
  const canHideMahjong = canHideMahjongForCompletedWorld(game);

  return (
    <aside className="sidebar" aria-label="遊戲資訊">
      <div className="title-block">
        <p>SichuanP</p>
        <h1>四川麻將配對</h1>
      </div>

      <div className="stats">
        <Stat label="關卡" value={game.stageInfo.label} />
        <Stat label="剩餘牌組" value={remainingPairs} />
        <Stat label="已消除" value={game.clearedPairs} />
        <Stat label="難度" value={formatDifficulty(game.stageInfo)} />
      </div>

      <button type="button" className="restart-button" onClick={onRestart}>
        重玩本關
      </button>

      <div className="utility-actions">
        <button type="button" className="hint-button" onClick={onShowHint}>
          提示下一組
        </button>
        {canHideMahjong ? (
          <button
            type="button"
            className="photo-view-button"
            onClick={onToggleMahjongVisibility}
          >
            {game.mahjongHidden ? "顯示麻將" : "隱藏麻將"}
          </button>
        ) : null}
      </div>

      <AdminPanel game={game} onSelectStage={onSelectStage} />

      <StagePrompt
        game={game}
        onContinue={onContinue}
        onRestartFromFirst={onRestartFromFirst}
      />

      <p className="status-text" aria-live="polite">
        {game.statusText}
      </p>
    </aside>
  );
}

function App() {
  const {
    continueGame,
    game,
    restart,
    restartFromFirstStage,
    selectStage,
    selectTile,
    showHint,
    toggleMahjongVisibility,
  } = useGame();
  const landscape = getStageLandscape(game.stageInfo);
  const landscapeRevealCount = getLandscapeRevealCount(game);

  return (
    <main className="app-shell">
      <Sidebar
        game={game}
        onContinue={continueGame}
        onRestart={restart}
        onRestartFromFirst={restartFromFirstStage}
        onSelectStage={selectStage}
        onShowHint={showHint}
        onToggleMahjongVisibility={toggleMahjongVisibility}
      />
      <section
        className={[
          "play-area",
          game.mahjongHidden ? "play-area--mahjong-hidden" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{
          "--landscape-photo": landscape.image,
          "--landscape-position": landscape.position,
        }}
        aria-label={`遊戲棋盤，${landscape.name}風景，已解鎖 ${landscapeRevealCount} / ${STAGES_PER_WORLD} 個彩色區域`}
      >
        <div className="landscape-color-grid" aria-hidden="true">
          {LANDSCAPE_REGIONS.map((region) => (
            <span
              className={[
                "landscape-color-region",
                region.id <= landscapeRevealCount
                  ? "landscape-color-region--revealed"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={region.id}
              style={{ "--region-clip": region.clipPath }}
            />
          ))}
        </div>
        <Board game={game} onSelect={selectTile} />
        <div className="progress-strip" aria-hidden="true">
          <span
            style={{
              width: `${game.totalPairs > 0 ? (game.clearedPairs / game.totalPairs) * 100 : 0}%`,
            }}
          />
        </div>
      </section>
    </main>
  );
}

const rootElement = document.querySelector("#root");
const root = globalThis.__sichuanpRoot ?? createRoot(rootElement);
globalThis.__sichuanpRoot = root;
root.render(<App />);
