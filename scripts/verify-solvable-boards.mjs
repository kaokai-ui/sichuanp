import { SOLVABLE_BOARDS } from "../src/solvable-boards.js";
import {
  analyzePair,
  countRemainingTiles,
  isBoardSolvable,
  removePair,
} from "../src/game.js";
import {
  calculateSmokeMetrics,
  factorial,
  getSmokeStartStage,
  ROUTE_LIMIT_BY_SUBSTAGE,
} from "./route-metrics.mjs";

function isSmokeEnabledForStage(stage) {
  return stage.stage >= getSmokeStartStage(stage.world);
}

function createTileObject(type, under = null, options = {}) {
  const tile = {
    type,
    label: type,
    ...(options.covered ? { covered: true } : {}),
  };

  return under ? { ...tile, under } : tile;
}

function createTile(type) {
  if (type === null) {
    return null;
  }

  if (Array.isArray(type)) {
    if (type.length === 1) {
      return createTileObject(type[0], null, { covered: true });
    }

    return type.reduce((under, tileType, index) => {
      return createTileObject(tileType, under, { covered: index === 0 });
    }, null);
  }

  return createTileObject(type);
}

function createBoardFromLayout(layout) {
  return layout.map((row) => row.map((type) => createTile(type)));
}

function createFilledBoard(rows = 6, cols = 6) {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => createTile("x")),
  );
}

function assert(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

function getDesignedRouteCount(routeGroupSizes) {
  return routeGroupSizes.reduce((total, size) => total * factorial(size), 1);
}

function replayRoutePlan(record, board, errors) {
  let currentBoard = board;
  const routePlan = Array.isArray(record.routePlan) ? record.routePlan : [];

  routePlan.forEach((step, index) => {
    const result = analyzePair(currentBoard, step.first, step.second);

    assert(
      result.ok && result.tile.type === step.type,
      `${record.id}: routePlan step ${index + 1} is not playable in sequence.`,
      errors,
    );

    if (result.ok) {
      currentBoard = removePair(currentBoard, step.first, step.second);
    }
  });

  assert(
    countRemainingTiles(currentBoard) === 0,
    `${record.id}: routePlan replay did not clear the board.`,
    errors,
  );
}

function verifyPairCounts(record, errors) {
  const counts = new Map();

  for (const row of record.tiles) {
    for (const cell of row) {
      if (cell === null) {
        continue;
      }

      const types = Array.isArray(cell) ? cell : [cell];

      for (const type of types) {
        counts.set(type, (counts.get(type) ?? 0) + 1);
      }
    }
  }

  for (const [type, count] of counts.entries()) {
    assert(
      count > 0 && count % 2 === 0,
      `${record.id}: ${type} appears ${count} times; every tile type must appear in pairs.`,
      errors,
    );
  }
}

function verifyStoredBoards(errors) {
  assert(
    SOLVABLE_BOARDS.length === 100,
    `Expected 100 boards, got ${SOLVABLE_BOARDS.length}.`,
    errors,
  );

  const stageLabels = new Set();

  for (const record of SOLVABLE_BOARDS) {
    assert(Array.isArray(record.tiles), `${record.id}: tiles must be an array.`, errors);
    const rowCount = record.tiles.length;
    const colCount = record.tiles[0]?.length ?? 0;

    assert(
      rowCount > 0 && colCount > 0,
      `${record.id}: board must have positive dimensions.`,
      errors,
    );

    if (record.stage?.label) {
      assert(
        !stageLabels.has(record.stage.label),
        `${record.id}: duplicate stage label ${record.stage.label}.`,
        errors,
      );
      stageLabels.add(record.stage.label);
    }
    assert(
      Number.isInteger(record.difficulty) &&
        record.difficulty >= 0 &&
        record.difficulty <= 100,
      `${record.id}: difficulty must be an integer from 0 to 100.`,
      errors,
    );
    assert(
      record.stage?.number === record.difficulty,
      `${record.id}: stage number must match difficulty.`,
      errors,
    );
    assert(
      record.stage?.world >= 1 &&
        record.stage?.world <= 10 &&
        record.stage?.stage >= 1 &&
        record.stage?.stage <= 10,
      `${record.id}: stage metadata must be within 1-1 to 10-10.`,
      errors,
    );

    for (const row of record.tiles) {
      assert(
        Array.isArray(row) && row.length === colCount,
        `${record.id}: every row must have ${colCount} columns.`,
        errors,
      );
    }

    verifyPairCounts(record, errors);

    const board = createBoardFromLayout(record.tiles);
    const remainingTiles = countRemainingTiles(board);
    const routeLimit = ROUTE_LIMIT_BY_SUBSTAGE[record.stage.stage - 1];
    const routeGroupSizes = record.routeGroupSizes ?? [];
    const routePlan = record.routePlan ?? [];
    const routeGroupTotal = routeGroupSizes.reduce((sum, size) => sum + size, 0);
    const smokeEnabled = isSmokeEnabledForStage(record.stage);

    assert(
      remainingTiles > 0 && remainingTiles % 2 === 0,
      `${record.id}: board must start with a positive even number of tiles.`,
      errors,
    );
    assert(
      record.metrics?.routeLimit === routeLimit,
      `${record.id}: routeLimit ${record.metrics?.routeLimit} must match substage limit ${routeLimit}.`,
      errors,
    );
    assert(
      Number.isFinite(record.metrics?.routeCount),
      `${record.id}: routeCount must be recorded.`,
      errors,
    );
    assert(
      !record.metrics?.routeCountCapped,
      `${record.id}: routeCount must be exact for route-limited stages.`,
      errors,
    );
    assert(
      record.metrics?.routeCount <= routeLimit,
      `${record.id}: routeCount ${record.metrics?.routeCount} exceeds limit ${routeLimit}.`,
      errors,
    );
    assert(
      Array.isArray(record.routeGroupSizes) &&
        routeGroupSizes.every((size) => Number.isInteger(size) && size > 0) &&
        routeGroupTotal === remainingTiles / 2,
      `${record.id}: routeGroupSizes must cover every planned pair.`,
      errors,
    );
    assert(
      record.metrics?.routeCount === getDesignedRouteCount(routeGroupSizes),
      `${record.id}: routeCount must match routeGroupSizes factorial product.`,
      errors,
    );
    assert(
      Array.isArray(record.routePlan) && routePlan.length === remainingTiles / 2,
      `${record.id}: routePlan must include one step for every pair.`,
      errors,
    );
    const smokeMetrics = smokeEnabled
      ? calculateSmokeMetrics(board, routePlan, routeGroupSizes)
      : {
          initialSmokePairs: 0,
          maxSmokePairs: 0,
          smokePairCount: 0,
          smokeStepCount: 0,
        };
    assert(
      record.metrics?.smokeEnabled === smokeEnabled &&
      record.metrics?.smokePairCount === smokeMetrics.smokePairCount &&
        record.metrics?.smokeStepCount === smokeMetrics.smokeStepCount &&
        record.metrics?.maxSmokePairs === smokeMetrics.maxSmokePairs &&
        record.metrics?.initialSmokePairs === smokeMetrics.initialSmokePairs,
      `${record.id}: smoke metrics must match playable off-route pair counts.`,
      errors,
    );
    assert(
      !smokeEnabled || record.metrics?.smokePairCount > 0,
      `${record.id}: smoke-enabled boards should include at least one smoke pair.`,
      errors,
    );
    assert(
      !smokeEnabled ||
        record.metrics?.smokePairCount >=
          record.stage.stage - getSmokeStartStage(record.stage.world) + 1,
      `${record.id}: smoke-enabled boards should meet the stage smoke minimum.`,
      errors,
    );
    assert(
      smokeEnabled || record.metrics?.smokePairCount === 0,
      `${record.id}: smoke-disabled boards should not report smoke pairs.`,
      errors,
    );
    assert(
      record.stage?.world !== 1 || remainingTiles === 36,
      `${record.id}: first world boards must use 36 full-board tiles.`,
      errors,
    );
    assert(
      record.stage?.world !== 2 || remainingTiles === 50,
      `${record.id}: second world boards must use 50 tiles.`,
      errors,
    );
    assert(
      record.stage?.world !== 3 || remainingTiles === 52,
      `${record.id}: third world boards must use 52 layered full-board tiles.`,
      errors,
    );
    assert(
      record.stage?.world !== 4 || remainingTiles === 60,
      `${record.id}: fourth world boards must use 60 filled layered tiles.`,
      errors,
    );
    assert(
      record.stage?.world !== 5 || remainingTiles === 62,
      `${record.id}: fifth world boards must use 62 frame tiles.`,
      errors,
    );
    assert(
      record.stage?.world !== 6 || remainingTiles === 68,
      `${record.id}: sixth world boards must use 68 photo-frame tiles.`,
      errors,
    );
    assert(
      record.stage?.world !== 7 || remainingTiles === 78,
      `${record.id}: seventh world boards must use 78 layered mound tiles.`,
      errors,
    );
    assert(
      record.stage?.world !== 8 || remainingTiles === 92,
      `${record.id}: eighth world boards must use 92 layered frame tiles.`,
      errors,
    );
    assert(
      record.stage?.world !== 9 || remainingTiles === 94,
      `${record.id}: ninth world boards must use 94 layered photo-frame tiles.`,
      errors,
    );
    assert(
      record.stage?.world !== 10 || remainingTiles === 92,
      `${record.id}: tenth world boards must use 92 triple-layer mound tiles.`,
      errors,
    );
    assert(isBoardSolvable(board), `${record.id}: solver could not solve board.`, errors);
    replayRoutePlan(record, board, errors);
  }

  assert(stageLabels.size === 100, `Expected 100 unique stages, got ${stageLabels.size}.`, errors);
  const worldTenStart = SOLVABLE_BOARDS.find((record) => record.stage?.label === "10-1");
  const worldTenFinal = SOLVABLE_BOARDS.find((record) => record.stage?.label === "10-10");
  assert(
    (worldTenFinal?.metrics?.smokePairCount ?? 0) >
      (worldTenStart?.metrics?.smokePairCount ?? 0),
    "10-10 should report more smoke pairs than 10-1.",
    errors,
  );
}

function verifyTurnLimitRegression(errors) {
  const threeTurnBoard = createFilledBoard();
  threeTurnBoard[4][5] = createTile("f4");
  threeTurnBoard[5][2] = createTile("f4");
  const threeTurnResult = analyzePair(
    threeTurnBoard,
    { row: 4, col: 5 },
    { row: 5, col: 2 },
  );

  assert(
    !threeTurnResult.ok && threeTurnResult.reason === "path-blocked",
    "A right-edge to bottom-edge path that needs three turns must be rejected.",
    errors,
  );

  const twoTurnBoard = createFilledBoard();
  twoTurnBoard[5][2] = createTile("f4");
  twoTurnBoard[5][4] = createTile("f4");
  const twoTurnResult = analyzePair(
    twoTurnBoard,
    { row: 5, col: 2 },
    { row: 5, col: 4 },
  );

  assert(
    twoTurnResult.ok,
    "A bottom-edge path using down, across, and up should be allowed as two turns.",
    errors,
  );
}

const errors = [];
verifyStoredBoards(errors);
verifyTurnLimitRegression(errors);

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  const difficulties = SOLVABLE_BOARDS.map((record) => record.difficulty);
  const stages = new Set(SOLVABLE_BOARDS.map((record) => record.stage.label));
  console.log(
    JSON.stringify(
      {
        boards: SOLVABLE_BOARDS.length,
        stages: stages.size,
        minDifficulty: Math.min(...difficulties),
        maxDifficulty: Math.max(...difficulties),
        turnLimitRegression: "passed",
      },
      null,
      2,
    ),
  );
}
