import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzePair,
  countRemainingTiles,
  findMoves,
  isBoardSolvable,
  isTileOpen,
  removePair,
} from "../src/game.js";

const TARGET_COUNT = 100;
const MIN_RATING = 0;
const MAX_ATTEMPTS = 50000;
const DEFAULT_SEED = "20260428";
const OUTPUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/solvable-boards.js",
);

const FLOWER_TYPES = ["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"];
const HONOR_TYPES = ["E", "S", "W", "N", "R", "G"];
const STANDARD_TYPES = [
  ...Array.from({ length: 9 }, (_, index) => `m${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `p${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `s${index + 1}`),
];
const PAIR_TYPES = [...FLOWER_TYPES, ...HONOR_TYPES, ...STANDARD_TYPES];
const DEFAULT_ROWS = 6;
const DEFAULT_COLS = 6;
const ROUTE_COUNT_LIMIT = 999;
const ROUTE_NODE_LIMIT = 14000;
const ROUTE_LIMIT_BY_SUBSTAGE = [400, 200, 100, 60, 30, 15, 8, 4, 2, 1];
const ROUTE_GROUP_TEMPLATE_BY_LIMIT = new Map([
  [400, [4, 3, 2]],
  [200, [4, 3]],
  [100, [4, 2, 2]],
  [60, [4, 2]],
  [30, [3, 2, 2]],
  [15, [3, 2]],
  [8, [2, 2, 2]],
  [4, [2, 2]],
  [2, [2]],
  [1, []],
]);

function getSmokeStartStage(world) {
  if (world <= 1) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(1, 11 - world);
}

function getSmokeSettingsForStage(record) {
  const startStage = getSmokeStartStage(record.stage.world);
  const enabled = record.stage.stage >= startStage;

  if (!enabled) {
    return {
      enabled: false,
      minPairs: 0,
    };
  }

  return {
    enabled: true,
    minPairs: Math.max(1, record.stage.stage - startStage + 1),
  };
}

function maskFromPattern(pattern) {
  return pattern.map((row) => [...row].map((cell) => (cell === "1" || cell === "#" ? 1 : 0)));
}

function mirrorPattern(pattern) {
  return pattern.map((row) => [...row].reverse().join(""));
}

function hasTileInDirection(mask, row, col, deltaRow, deltaCol) {
  for (
    let nextRow = row + deltaRow, nextCol = col + deltaCol;
    nextRow >= 0 &&
    nextRow < mask.length &&
    nextCol >= 0 &&
    nextCol < mask[nextRow].length;
    nextRow += deltaRow, nextCol += deltaCol
  ) {
    if (mask[nextRow][nextCol]) {
      return true;
    }
  }

  return false;
}

function createFilledLowerMask(upper) {
  return upper.map((row, rowIndex) =>
    row.map((_, colIndex) =>
      !upper[rowIndex][colIndex] &&
      hasTileInDirection(upper, rowIndex, colIndex, 0, -1) &&
      hasTileInDirection(upper, rowIndex, colIndex, 0, 1) &&
      hasTileInDirection(upper, rowIndex, colIndex, -1, 0) &&
      hasTileInDirection(upper, rowIndex, colIndex, 1, 0)
        ? 1
        : 0,
    ),
  );
}

function layeredMaskFromUpperPattern(upperPattern) {
  const upper = maskFromPattern(upperPattern);
  const lower = createFilledLowerMask(upper);

  return lower.map((row, rowIndex) =>
    row.map((cell, colIndex) => ({
      lower: Boolean(cell),
      upper: Boolean(upper[rowIndex][colIndex]),
    })),
  );
}

function layeredMaskFromLayerPatterns(layerPatterns) {
  const layers = layerPatterns.map((pattern) => maskFromPattern(pattern));
  const rows = layers[0].length;
  const cols = layers[0][0].length;

  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => {
      let depth = 0;

      for (const layer of layers) {
        if (layer[row][col]) {
          depth += 1;
        }
      }

      return depth > 0 ? { depth } : 0;
    }),
  );
}

const WORLD_ONE_REFERENCE_PATTERN = [
  "#############",
  "###.......###",
  "###.......###",
  "###.......###",
  "###.......###",
  "###.......###",
  "###.......###",
  "#############",
];
const WORLD_ONE_MASKS = Array.from({ length: 10 }, () =>
  maskFromPattern(WORLD_ONE_REFERENCE_PATTERN),
);
const WORLD_TWO_REFERENCE_PATTERN = [
  "...####...",
  "..######..",
  ".########.",
  "##########",
  "#########.",
  ".########.",
  "...#####..",
];
const WORLD_TWO_MIRRORED_PATTERN = mirrorPattern(WORLD_TWO_REFERENCE_PATTERN);
const WORLD_TWO_MASKS = Array.from({ length: 10 }, (_, index) =>
  maskFromPattern(index % 2 === 0 ? WORLD_TWO_REFERENCE_PATTERN : WORLD_TWO_MIRRORED_PATTERN),
);
const WORLD_THREE_REFERENCE_PATTERN = [
  "#############",
  "#..#.....#.##",
  "####.###.####",
  "###..###.####",
  "####.##..####",
  "#..#.##...#.#",
  "#############",
];
const WORLD_THREE_MIRRORED_PATTERN = mirrorPattern(WORLD_THREE_REFERENCE_PATTERN);
const WORLD_THREE_MASKS = Array.from({ length: 10 }, (_, index) =>
  maskFromPattern(index % 2 === 0 ? WORLD_THREE_REFERENCE_PATTERN : WORLD_THREE_MIRRORED_PATTERN),
);
const WORLD_FOUR_REFERENCE_PATTERN = [
  "######",
  "######",
  "######",
  "######",
  "######",
  "######",
];
const WORLD_FIVE_UPPER_PATTERN = [
  "#####...#####",
  "#...#...#...#",
  "#...#...#...#",
  "#...#...#...#",
  "#...#...#...#",
  "#####...#####",
  ".............",
];
const WORLD_FIVE_UPPER_MIRRORED_PATTERN = mirrorPattern(WORLD_FIVE_UPPER_PATTERN);
const WORLD_FIVE_MASKS = Array.from({ length: 10 }, (_, index) =>
  index % 2 === 0
    ? layeredMaskFromUpperPattern(WORLD_FIVE_UPPER_PATTERN)
    : layeredMaskFromUpperPattern(WORLD_FIVE_UPPER_MIRRORED_PATTERN),
);
const WORLD_SIX_UPPER_PATTERN = [
  "..#########..",
  "..#.......#..",
  "..#.......#..",
  "..#.......#..",
  "..#.......#..",
  "..#.......#..",
  "..#.......#..",
  "..#########..",
];
const WORLD_SIX_MASKS = Array.from({ length: 10 }, () =>
  layeredMaskFromLayerPatterns([WORLD_ONE_REFERENCE_PATTERN, WORLD_SIX_UPPER_PATTERN]),
);
const WORLD_SEVEN_UPPER_PATTERN = [
  "..........",
  "...####...",
  "..######..",
  ".########.",
  "..######..",
  "...####...",
  "..........",
];
const WORLD_SEVEN_UPPER_MIRRORED_PATTERN = mirrorPattern(WORLD_SEVEN_UPPER_PATTERN);
const WORLD_SEVEN_MASKS = Array.from({ length: 10 }, (_, index) =>
  index % 2 === 0
    ? layeredMaskFromLayerPatterns([WORLD_TWO_REFERENCE_PATTERN, WORLD_SEVEN_UPPER_PATTERN])
    : layeredMaskFromLayerPatterns([WORLD_TWO_MIRRORED_PATTERN, WORLD_SEVEN_UPPER_MIRRORED_PATTERN]),
);
const WORLD_EIGHT_UPPER_PATTERN = [
  ".............",
  "...#.....#...",
  ".##..###..##.",
  ".##..###..##.",
  ".##..##...##.",
  "...#.##...#..",
  ".............",
];
const WORLD_EIGHT_UPPER_MIRRORED_PATTERN = mirrorPattern(WORLD_EIGHT_UPPER_PATTERN);
const WORLD_EIGHT_MASKS = Array.from({ length: 10 }, (_, index) =>
  index % 2 === 0
    ? layeredMaskFromLayerPatterns([WORLD_THREE_REFERENCE_PATTERN, WORLD_EIGHT_UPPER_PATTERN])
    : layeredMaskFromLayerPatterns([WORLD_THREE_MIRRORED_PATTERN, WORLD_EIGHT_UPPER_MIRRORED_PATTERN]),
);
const WORLD_NINE_UPPER_PATTERN = [
  "......",
  ".####.",
  ".####.",
  ".####.",
  ".####.",
  "......",
];
const WORLD_NINE_MASKS = Array.from({ length: 10 }, () =>
  layeredMaskFromLayerPatterns([WORLD_FOUR_REFERENCE_PATTERN, WORLD_NINE_UPPER_PATTERN]),
);
const WORLD_TEN_TOP_PATTERN = [
  "..........",
  "..........",
  "...####...",
  "..######..",
  "...####...",
  "..........",
  "..........",
];
const WORLD_TEN_TOP_MIRRORED_PATTERN = mirrorPattern(WORLD_TEN_TOP_PATTERN);
const WORLD_TEN_MASKS = Array.from({ length: 10 }, (_, index) =>
  index % 2 === 0
    ? layeredMaskFromLayerPatterns([
        WORLD_TWO_REFERENCE_PATTERN,
        WORLD_SEVEN_UPPER_PATTERN,
        WORLD_TEN_TOP_PATTERN,
      ])
    : layeredMaskFromLayerPatterns([
        WORLD_TWO_MIRRORED_PATTERN,
        WORLD_SEVEN_UPPER_MIRRORED_PATTERN,
        WORLD_TEN_TOP_MIRRORED_PATTERN,
      ]),
);

function parseOptions() {
  const options = {
    count: TARGET_COUNT,
    minRating: MIN_RATING,
    maxAttempts: MAX_ATTEMPTS,
    seed: DEFAULT_SEED,
    solverCheck: false,
  };

  for (const argument of process.argv.slice(2)) {
    const [name, value] = argument.replace(/^--/, "").split("=");

    if (name === "count") {
      options.count = Number(value);
    } else if (name === "minDifficulty" || name === "minRating") {
      options.minRating = Number(value);
    } else if (name === "maxAttempts") {
      options.maxAttempts = Number(value);
    } else if (name === "seed") {
      options.seed = value;
    } else if (name === "solverCheck") {
      options.solverCheck = value === "true" || value === "1";
    }
  }

  return options;
}

function hashSeed(seed) {
  const text = String(seed);
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createRandom(seed) {
  let state = hashSeed(seed) || 0x6d2b79f5;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function shuffleArray(items, random) {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

function createEmptyBoard(rows = DEFAULT_ROWS, cols = DEFAULT_COLS) {
  return Array.from({ length: rows }, () => Array(cols).fill(null));
}

function cloneTile(tile) {
  if (!tile) {
    return null;
  }

  return createTile(tile.type, cloneTile(tile.under), { covered: tile.covered });
}

function cloneBoard(board) {
  return board.map((row) => row.map((tile) => cloneTile(tile)));
}

function createTile(type, under = null, options = {}) {
  const tile = {
    type,
    label: type,
    ...(options.covered ? { covered: true } : {}),
  };

  return under ? { ...tile, under } : tile;
}

function createTileStack(types, options = {}) {
  return types.reduce((under, type, index) => {
    const covered =
      (types.length === 1 && options.singleCovered) ||
      (index === 0 && options.coveredBottom);
    return createTile(type, under, { covered });
  }, null);
}

function createCandidateStack(depth, options = {}) {
  return createTileStack(Array.from({ length: depth }, () => "candidate"), options);
}

function getTileStackTypes(tile) {
  const types = [];
  let current = tile;

  while (current) {
    types.unshift(current.type);
    current = current.under;
  }

  return types;
}

function hasCoveredTile(tile) {
  let current = tile;

  while (current) {
    if (current.covered) {
      return true;
    }

    current = current.under;
  }

  return false;
}

function manhattanDistance(first, second) {
  return Math.abs(first.row - second.row) + Math.abs(first.col - second.col);
}

function createTilePlacementOrder(random, pairCount) {
  const types = [];

  while (types.length < pairCount) {
    types.push(...shuffleArray(PAIR_TYPES, random));
  }

  return shuffleArray(types.slice(0, pairCount), random);
}

function createFullOccupancyBoard(mask = null) {
  const rows = mask?.length ?? DEFAULT_ROWS;
  const cols = mask?.[0]?.length ?? DEFAULT_COLS;

  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => {
      const cell = mask ? mask[row][col] : 1;

      if (cell && typeof cell === "object") {
        if (Number.isInteger(cell.depth)) {
          return cell.depth > 0
            ? createCandidateStack(cell.depth, {
                coveredBottom: true,
                singleCovered: true,
              })
            : null;
        }

        const lower = cell.lower
          ? createTile("candidate", null, { covered: true })
          : null;
        return cell.upper ? createTile("candidate", lower) : lower;
      }

      return cell > 0 ? createCandidateStack(cell) : null;
    }),
  );
}

function getOccupiedPositions(board) {
  const positions = [];

  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      if (board[row][col]) {
        positions.push({ row, col });
      }
    }
  }

  return positions;
}

function getLegalPositionPairs(board, random) {
  const positions = getOccupiedPositions(board);
  const pairs = [];

  for (let firstIndex = 0; firstIndex < positions.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < positions.length; secondIndex += 1) {
      const first = positions[firstIndex];
      const second = positions[secondIndex];

      if (analyzePair(board, first, second).ok) {
        pairs.push({
          first,
          second,
          score: manhattanDistance(first, second) + random() * 0.55,
        });
      }
    }
  }

  pairs.sort((left, right) => right.score - left.score);
  return pairs;
}

function chooseSolutionPair(board, random) {
  const pairs = getLegalPositionPairs(board, random);

  if (pairs.length === 0) {
    return null;
  }

  const poolSize = Math.max(1, Math.ceil(pairs.length * 0.48));
  const index = Math.floor(random() ** 1.7 * poolSize);
  return pairs[Math.min(index, poolSize - 1)];
}

function createSolutionSkeleton(random, mask = null) {
  let board = createFullOccupancyBoard(mask);
  const solution = [];

  while (countRemainingTiles(board) > 0) {
    const pair = chooseSolutionPair(board, random);

    if (!pair) {
      return null;
    }

    solution.push(pair);
    board = removePair(board, pair.first, pair.second);
  }

  return solution;
}

function createBoardTileFromStack(stack, cell = null) {
  if (stack.length === 0) {
    return null;
  }

  if (cell && typeof cell === "object") {
    if (Number.isInteger(cell.depth)) {
      return createTileStack(stack, {
        coveredBottom: true,
        singleCovered: true,
      });
    }

    if (cell.lower && cell.upper) {
      return createTile(stack[1], createTile(stack[0], null, { covered: true }));
    }

    if (cell.lower) {
      return createTile(stack[0], null, { covered: true });
    }

    return createTile(stack[0]);
  }

  return createTileStack(stack);
}

function createCandidateBoard(random, mask = null) {
  const solutionSkeleton = createSolutionSkeleton(random, mask);

  if (!solutionSkeleton) {
    return null;
  }

  const rows = mask?.length ?? DEFAULT_ROWS;
  const cols = mask?.[0]?.length ?? DEFAULT_COLS;
  const types = createTilePlacementOrder(random, solutionSkeleton.length);
  const placements = solutionSkeleton.map((pair, index) => ({
    type: types[index],
    first: pair.first,
    second: pair.second,
  }));

  const cellStacks = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => []),
  );

  for (let index = placements.length - 1; index >= 0; index -= 1) {
    const placement = placements[index];
    cellStacks[placement.first.row][placement.first.col].push(placement.type);
    cellStacks[placement.second.row][placement.second.col].push(placement.type);
  }

  const board = cellStacks.map((row, rowIndex) =>
    row.map((stack, colIndex) =>
      createBoardTileFromStack(stack, mask?.[rowIndex]?.[colIndex] ?? null),
    ),
  );

  return {
    board,
    solution: placements,
  };
}

function layoutFromBoard(board) {
  return board.map((row) =>
    row.map((tile) => {
      if (!tile) {
        return null;
      }

      const types = getTileStackTypes(tile);
      return types.length > 1 || hasCoveredTile(tile) ? types : types[0];
    }),
  );
}

function getBoardKey(board) {
  return JSON.stringify(layoutFromBoard(board));
}

function getOpenTileStats(board) {
  let openTiles = 0;
  let totalTiles = 0;

  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      if (board[row][col]) {
        totalTiles += 1;

        if (isTileOpen(board, row, col)) {
          openTiles += 1;
        }
      }
    }
  }

  return { openTiles, totalTiles };
}

function replaySolution(board, solution) {
  let currentBoard = cloneBoard(board);

  for (const step of solution) {
    if (!analyzePair(currentBoard, step.first, step.second).ok) {
      return false;
    }

    currentBoard = removePair(currentBoard, step.first, step.second);
  }

  return countRemainingTiles(currentBoard) === 0;
}

function countSolutionRoutes(board, options = {}) {
  const limit = options.limit ?? ROUTE_COUNT_LIMIT;
  const nodeLimit = options.nodeLimit ?? ROUTE_NODE_LIMIT;
  const memo = new Map();
  const state = { nodes: 0, capped: false };

  function countFrom(currentBoard) {
    if (state.nodes > nodeLimit) {
      state.capped = true;
      return limit;
    }

    const remainingTiles = countRemainingTiles(currentBoard);

    if (remainingTiles === 0) {
      return 1;
    }

    const key = getBoardKey(currentBoard);

    if (memo.has(key)) {
      return memo.get(key);
    }

    state.nodes += 1;
    let routes = 0;

    for (const move of findMoves(currentBoard)) {
      routes += countFrom(removePair(currentBoard, move.first, move.second));

      if (routes >= limit) {
        state.capped = true;
        routes = limit;
        break;
      }
    }

    memo.set(key, routes);
    return routes;
  }

  return {
    routeCount: countFrom(cloneBoard(board)),
    routeCountCapped: state.capped,
    routeNodes: state.nodes,
  };
}

function calculateDifficulty(board, solution) {
  let currentBoard = cloneBoard(board);
  const moveCounts = [];
  const openRatios = [];
  const distances = [];
  let bottleneckSteps = 0;

  for (const step of solution) {
    const moves = findMoves(currentBoard);
    const openStats = getOpenTileStats(currentBoard);

    moveCounts.push(moves.length);
    openRatios.push(openStats.openTiles / openStats.totalTiles);
    distances.push(manhattanDistance(step.first, step.second));

    if (moves.length <= 1) {
      bottleneckSteps += 1;
    }

    currentBoard = removePair(currentBoard, step.first, step.second);
  }

  const averageMoves =
    moveCounts.reduce((sum, value) => sum + value, 0) / moveCounts.length;
  const averageOpenRatio =
    openRatios.reduce((sum, value) => sum + value, 0) / openRatios.length;
  const averageDistance =
    distances.reduce((sum, value) => sum + value, 0) / distances.length;
  const initialOpenStats = getOpenTileStats(board);
  const initialBlockedRatio =
    1 - initialOpenStats.openTiles / initialOpenStats.totalTiles;
  const initialMoves = moveCounts[0];

  const choicePressure = clamp((averageMoves - 1.1) / 4.8);
  const initialChoicePressure = clamp((initialMoves - 1) / 7);
  const blockedPressure = clamp(initialBlockedRatio / 0.52);
  const distancePressure = clamp((averageDistance - 2) / 5.5);
  const bottleneckRelief = clamp(bottleneckSteps / solution.length);
  const rawScore =
    100 *
      (choicePressure * 0.35 +
        initialChoicePressure * 0.19 +
        blockedPressure * 0.23 +
        distancePressure * 0.23) -
    bottleneckRelief * 13.5;
  const rating = Math.round(clamp(rawScore, 0, 100));
  return {
    rating,
    metrics: {
      rating,
      initialMoves,
      averageMoves: round(averageMoves),
      minMoves: Math.min(...moveCounts),
      maxMoves: Math.max(...moveCounts),
      averageOpenRatio: round(averageOpenRatio),
      initialBlockedRatio: round(initialBlockedRatio),
      averageDistance: round(averageDistance),
      bottleneckSteps,
    },
  };
}

function factorial(value) {
  let result = 1;

  for (let index = 2; index <= value; index += 1) {
    result *= index;
  }

  return result;
}

function samePosition(left, right) {
  return left?.row === right?.row && left?.col === right?.col;
}

function sameMove(left, right) {
  return (
    (samePosition(left.first, right.first) && samePosition(left.second, right.second)) ||
    (samePosition(left.first, right.second) && samePosition(left.second, right.first))
  );
}

function sameRouteStep(step, move, board) {
  const tile = board[move.first.row]?.[move.first.col];

  if (!tile || step.type !== tile.type) {
    return false;
  }

  return sameMove(step, move);
}

function buildRoutePolicy(solution, routeLimit = ROUTE_COUNT_LIMIT) {
  const template = ROUTE_GROUP_TEMPLATE_BY_LIMIT.get(routeLimit) ?? [];
  const routeGroupSizes = [];
  let remaining = solution.length;
  let routeCount = 1;

  for (const size of template) {
    if (remaining < size) {
      break;
    }

    routeGroupSizes.push(size);
    routeCount *= factorial(size);
    remaining -= size;
  }

  while (remaining > 0) {
    routeGroupSizes.push(1);
    remaining -= 1;
  }

  return {
    routeLimit,
    routeCount,
    routeCountCapped: false,
    routeGroupSizes,
    routePlan: solution.map((step) => ({
      type: step.type,
      first: step.first,
      second: step.second,
    })),
  };
}

function calculateSmokeMetrics(board, routePlan, routeGroupSizes) {
  let currentBoard = cloneBoard(board);
  let smokePairCount = 0;
  let smokeStepCount = 0;
  let maxSmokePairs = 0;
  let initialSmokePairs = 0;
  let groupStart = 0;

  for (const groupSize of routeGroupSizes) {
    const consumed = [];

    for (let offset = 0; offset < groupSize; offset += 1) {
      const groupEnd = groupStart + groupSize;
      const moves = findMoves(currentBoard);
      const allowedMoves = moves.filter((move) =>
        routePlan
          .slice(groupStart, groupEnd)
          .some((step, index) => {
            const routeIndex = groupStart + index;
            return !consumed.includes(routeIndex) && sameRouteStep(step, move, currentBoard);
          }),
      );
      const smokePairs = moves.filter(
        (move) => !allowedMoves.some((allowedMove) => sameMove(allowedMove, move)),
      );

      if (smokePairs.length > 0) {
        smokePairCount += smokePairs.length;
        smokeStepCount += 1;
        maxSmokePairs = Math.max(maxSmokePairs, smokePairs.length);

        if (groupStart === 0 && offset === 0) {
          initialSmokePairs = smokePairs.length;
        }
      }

      const routeIndex = routePlan.findIndex((step, index) => {
        return (
          index >= groupStart &&
          index < groupEnd &&
          !consumed.includes(index) &&
          analyzePair(currentBoard, step.first, step.second).ok
        );
      });

      if (routeIndex === -1) {
        break;
      }

      consumed.push(routeIndex);
      currentBoard = removePair(
        currentBoard,
        routePlan[routeIndex].first,
        routePlan[routeIndex].second,
      );
    }

    groupStart += groupSize;
  }

  return {
    initialSmokePairs,
    maxSmokePairs,
    smokePairCount,
    smokeStepCount,
  };
}

function getStageMetadata(index) {
  const number = index + 1;
  const world = Math.floor(index / 10) + 1;
  const stage = (index % 10) + 1;

  return {
    number,
    world,
    stage,
    label: `${world}-${stage}`,
  };
}

function createStageRecord(board, index) {
  const stage = getStageMetadata(index);

  return {
    id: `stage-${String(stage.world).padStart(2, "0")}-${String(stage.stage).padStart(2, "0")}`,
    stage,
    verified: board.verified,
    difficulty: stage.number,
    rating: board.rating,
    shape: board.shape ?? "full",
    metrics: board.metrics,
    routeGroupSizes: board.routeGroupSizes,
    routePlan: board.routePlan,
    tiles: board.tiles,
  };
}

function sortByRating(boards) {
  return [...boards].sort((left, right) => {
      if (left.rating !== right.rating) {
        return left.rating - right.rating;
      }

      if (left.metrics.averageMoves !== right.metrics.averageMoves) {
        return left.metrics.averageMoves - right.metrics.averageMoves;
      }

      return left.id.localeCompare(right.id);
    });
}

function assignStageMetadata(boards) {
  return sortByRating(boards).map((board, index) => createStageRecord(board, index));
}

function buildBoardRecordFromCandidate(candidate, shape, options = {}) {
  const { rating, metrics } = calculateDifficulty(candidate.board, candidate.solution);
  const routePolicy = buildRoutePolicy(candidate.solution, options.routeLimit);
  const smokeEnabled = options.smokeEnabled === true;
  const smokeMetrics = smokeEnabled
    ? calculateSmokeMetrics(
        candidate.board,
        routePolicy.routePlan,
        routePolicy.routeGroupSizes,
      )
    : {
        initialSmokePairs: 0,
        maxSmokePairs: 0,
        smokePairCount: 0,
        smokeStepCount: 0,
      };

  return {
    verified: true,
    rating,
    shape,
    metrics: {
      ...metrics,
      routeLimit: routePolicy.routeLimit,
      routeCount: routePolicy.routeCount,
      routeCountCapped: routePolicy.routeCountCapped,
      smokeEnabled,
      ...smokeMetrics,
    },
    routeGroupSizes: routePolicy.routeGroupSizes,
    routePlan: routePolicy.routePlan,
    tiles: layoutFromBoard(candidate.board),
  };
}

function createVerifiedCandidate(
  random,
  options,
  shape = "full",
  mask = null,
  routeLimit = null,
  smokeSettings = {},
) {
  for (let attempt = 0; attempt < 2200; attempt += 1) {
    const candidate = createCandidateBoard(random, mask);

    if (!candidate) {
      continue;
    }

    const boardRecord = buildBoardRecordFromCandidate(candidate, shape, {
      routeLimit: routeLimit ?? ROUTE_COUNT_LIMIT,
      smokeEnabled: smokeSettings.enabled === true,
    });

    if (boardRecord.rating < options.minRating) {
      continue;
    }

    if (
      smokeSettings.enabled === true &&
      boardRecord.metrics.smokePairCount < (smokeSettings.minPairs ?? 1)
    ) {
      continue;
    }

    if (!replaySolution(candidate.board, candidate.solution)) {
      continue;
    }

    if (options.solverCheck && !isBoardSolvable(candidate.board)) {
      continue;
    }

    return boardRecord;
  }

  throw new Error(`Unable to create a verified ${shape} board.`);
}

function getRouteLimitForStage(record) {
  return ROUTE_LIMIT_BY_SUBSTAGE[record.stage.stage - 1];
}

function applyWorldOneFrameBoards(stagedBoards, random, options) {
  return stagedBoards.map((record) => {
    if (record.stage.world !== 5) {
      return record;
    }

    const mask = WORLD_ONE_MASKS[record.stage.stage - 1];
    const frameBoard = createVerifiedCandidate(
      random,
      options,
      "reference-frame-62",
      mask,
      getRouteLimitForStage(record),
      getSmokeSettingsForStage(record),
    );
    return createStageRecord(frameBoard, record.stage.number - 1);
  });
}

function applyWorldOneFullBoards(stagedBoards, random, options) {
  return stagedBoards.map((record) => {
    if (record.stage.world !== 1) {
      return record;
    }

    const fullBoard = createVerifiedCandidate(
      random,
      options,
      "full",
      null,
      getRouteLimitForStage(record),
      getSmokeSettingsForStage(record),
    );
    return createStageRecord(fullBoard, record.stage.number - 1);
  });
}

function applyWorldTwoIrregularBoards(stagedBoards, random, options) {
  return stagedBoards.map((record) => {
    if (record.stage.world !== 2) {
      return record;
    }

    const mask = WORLD_TWO_MASKS[record.stage.stage - 1];
    const irregularBoard = createVerifiedCandidate(
      random,
      options,
      "reference-mound-50",
      mask,
      getRouteLimitForStage(record),
      getSmokeSettingsForStage(record),
    );
    return createStageRecord(irregularBoard, record.stage.number - 1);
  });
}

function applyWorldThreeWideBoards(stagedBoards, random, options) {
  return stagedBoards.map((record) => {
    if (record.stage.world !== 6) {
      return record;
    }

    const mask = WORLD_THREE_MASKS[record.stage.stage - 1];
    const wideBoard = createVerifiedCandidate(
      random,
      options,
      "reference-photo-frame-68",
      mask,
      getRouteLimitForStage(record),
      getSmokeSettingsForStage(record),
    );
    return createStageRecord(wideBoard, record.stage.number - 1);
  });
}

function applyWorldFiveLayeredBoards(stagedBoards, random, options) {
  return stagedBoards.map((record) => {
    if (record.stage.world !== 4) {
      return record;
    }

    const mask = WORLD_FIVE_MASKS[record.stage.stage - 1];
    const layeredBoard = createVerifiedCandidate(
      random,
      options,
      "reference-layered-fill-60",
      mask,
      getRouteLimitForStage(record),
      getSmokeSettingsForStage(record),
    );
    return createStageRecord(layeredBoard, record.stage.number - 1);
  });
}

function applyWorldSixLayeredBoards(stagedBoards, random, options) {
  return stagedBoards.map((record) => {
    if (record.stage.world !== 8) {
      return record;
    }

    const mask = WORLD_SIX_MASKS[record.stage.stage - 1];
    const layeredBoard = createVerifiedCandidate(
      random,
      options,
      "reference-frame-layered-92",
      mask,
      getRouteLimitForStage(record),
      getSmokeSettingsForStage(record),
    );
    return createStageRecord(layeredBoard, record.stage.number - 1);
  });
}

function applyWorldSevenLayeredBoards(stagedBoards, random, options) {
  return stagedBoards.map((record) => {
    if (record.stage.world !== 7) {
      return record;
    }

    const mask = WORLD_SEVEN_MASKS[record.stage.stage - 1];
    const layeredBoard = createVerifiedCandidate(
      random,
      options,
      "reference-mound-layered-78",
      mask,
      getRouteLimitForStage(record),
      getSmokeSettingsForStage(record),
    );
    return createStageRecord(layeredBoard, record.stage.number - 1);
  });
}

function applyWorldEightLayeredBoards(stagedBoards, random, options) {
  return stagedBoards.map((record) => {
    if (record.stage.world !== 9) {
      return record;
    }

    const mask = WORLD_EIGHT_MASKS[record.stage.stage - 1];
    const layeredBoard = createVerifiedCandidate(
      random,
      options,
      "reference-photo-frame-layered-94",
      mask,
      getRouteLimitForStage(record),
      getSmokeSettingsForStage(record),
    );
    return createStageRecord(layeredBoard, record.stage.number - 1);
  });
}

function applyWorldNineLayeredBoards(stagedBoards, random, options) {
  return stagedBoards.map((record) => {
    if (record.stage.world !== 3) {
      return record;
    }

    const mask = WORLD_NINE_MASKS[record.stage.stage - 1];
    const layeredBoard = createVerifiedCandidate(
      random,
      options,
      "reference-full-layered-52",
      mask,
      getRouteLimitForStage(record),
      getSmokeSettingsForStage(record),
    );
    return createStageRecord(layeredBoard, record.stage.number - 1);
  });
}

function applyWorldTenTripleLayerBoards(stagedBoards, random, options) {
  return stagedBoards.map((record) => {
    if (record.stage.world !== 10) {
      return record;
    }

    const mask = WORLD_TEN_MASKS[record.stage.stage - 1];
    const layeredBoard = createVerifiedCandidate(
      random,
      options,
      "reference-mound-triple-92",
      mask,
      getRouteLimitForStage(record),
      getSmokeSettingsForStage(record),
    );
    return createStageRecord(layeredBoard, record.stage.number - 1);
  });
}

function serializeBoards(boards, options) {
  return `// Generated by scripts/generate-solvable-boards.mjs.
// Seed: ${options.seed}; replay verification: enabled; solver verification: ${options.solverCheck ? "enabled" : "disabled"}.
// Official difficulty is stage-based: 1-1 => 1/100, 10-10 => 100/100.

export const SOLVABLE_BOARDS = ${JSON.stringify(boards, null, 2)};
`;
}

async function main() {
  const options = parseOptions();
  const random = createRandom(options.seed);
  const boards = [];
  const seenBoards = new Set();
  const counters = {
    attempted: 0,
    failedConstruction: 0,
    duplicate: 0,
    tooSimple: 0,
    failedReplay: 0,
    failedSolver: 0,
  };

  while (
    boards.length < options.count &&
    counters.attempted < options.maxAttempts
  ) {
    counters.attempted += 1;
    const candidate = createCandidateBoard(random);

    if (!candidate) {
      counters.failedConstruction += 1;
      continue;
    }

    const boardKey = getBoardKey(candidate.board);

    if (seenBoards.has(boardKey)) {
      counters.duplicate += 1;
      continue;
    }

    const boardRecord = buildBoardRecordFromCandidate(candidate, "full");

    if (boardRecord.rating < options.minRating) {
      counters.tooSimple += 1;
      continue;
    }

    if (!replaySolution(candidate.board, candidate.solution)) {
      counters.failedReplay += 1;
      continue;
    }

    if (options.solverCheck && !isBoardSolvable(candidate.board)) {
      counters.failedSolver += 1;
      continue;
    }

    seenBoards.add(boardKey);
    boards.push({
      id: `candidate-${String(boards.length + 1).padStart(3, "0")}`,
      ...boardRecord,
    });

    if (boards.length % 10 === 0) {
      console.log(`generated ${boards.length}/${options.count}`);
    }
  }

  if (boards.length < options.count) {
    throw new Error(
      `Only generated ${boards.length}/${options.count} boards after ${counters.attempted} attempts. ${JSON.stringify(counters)}`,
    );
  }

  const stagedBoards = applyWorldTenTripleLayerBoards(
    applyWorldNineLayeredBoards(
      applyWorldEightLayeredBoards(
        applyWorldSevenLayeredBoards(
          applyWorldSixLayeredBoards(
            applyWorldFiveLayeredBoards(
              applyWorldThreeWideBoards(
                applyWorldTwoIrregularBoards(
                  applyWorldOneFrameBoards(assignStageMetadata(boards), random, options),
                  random,
                  options,
                ),
                random,
                options,
              ),
              random,
              options,
            ),
            random,
            options,
          ),
          random,
          options,
        ),
        random,
        options,
      ),
      random,
      options,
    ),
    random,
    options,
  );
  const routeLimitedBoards = applyWorldOneFullBoards(stagedBoards, random, options);
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, serializeBoards(routeLimitedBoards, options), "utf8");

  const difficulties = routeLimitedBoards.map((board) => board.difficulty);
  const ratings = routeLimitedBoards.map((board) => board.rating);
  console.log(
    JSON.stringify(
      {
        output: OUTPUT_PATH,
        count: routeLimitedBoards.length,
        seed: options.seed,
        solverCheck: options.solverCheck,
        minDifficulty: Math.min(...difficulties),
        maxDifficulty: Math.max(...difficulties),
        minRating: Math.min(...ratings),
        maxRating: Math.max(...ratings),
        counters,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
