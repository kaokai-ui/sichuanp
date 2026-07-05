import { SOLVABLE_BOARDS } from "./solvable-boards.js";

export const BOARD_SIZE = 6;
const MAX_TURNS = 2;
const SOLVER_NODE_LIMIT = 40000;

const FLOWER_TILES = [
  { type: "f1", label: "春" },
  { type: "f2", label: "夏" },
  { type: "f3", label: "秋" },
  { type: "f4", label: "冬" },
  { type: "f5", label: "梅" },
  { type: "f6", label: "蘭" },
  { type: "f7", label: "菊" },
  { type: "f8", label: "竹" },
];

const STANDARD_TILES = [
  ...Array.from({ length: 9 }, (_, index) => ({
    type: `m${index + 1}`,
    label: `${index + 1}萬`,
  })),
  ...Array.from({ length: 9 }, (_, index) => ({
    type: `p${index + 1}`,
    label: `${index + 1}筒`,
  })),
  ...Array.from({ length: 9 }, (_, index) => ({
    type: `s${index + 1}`,
    label: `${index + 1}條`,
  })),
];
const HONOR_TILES = [
  { type: "E", label: "東" },
  { type: "S", label: "南" },
  { type: "W", label: "西" },
  { type: "N", label: "北" },
  { type: "R", label: "中" },
  { type: "G", label: "發" },
];

const TILE_SET = [...STANDARD_TILES, ...HONOR_TILES, ...FLOWER_TILES];
const TILE_BY_TYPE = new Map(TILE_SET.map((tile) => [tile.type, tile]));
const DIRECTIONS = [
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1],
];

export function getBoardDimensions(board) {
  return {
    rows: board.length,
    cols: board[0]?.length ?? 0,
  };
}

function createEmptyBoard(rows = BOARD_SIZE, cols = BOARD_SIZE) {
  return Array.from({ length: rows }, () => Array(cols).fill(null));
}

function getFullBoardPositions(rows = BOARD_SIZE, cols = BOARD_SIZE) {
  const positions = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      positions.push({ row, col });
    }
  }

  return positions;
}

function shuffleArray(items, random = Math.random) {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

function createTilePool(random = Math.random) {
  const shuffledStandardTiles = shuffleArray(STANDARD_TILES, random).slice(0, 10);
  const selectedTiles = [...FLOWER_TILES, ...shuffledStandardTiles];

  return selectedTiles.flatMap((tile) => [tile.type, tile.type]);
}

function createTileByType(type, under = null, options = {}) {
  const tile = TILE_BY_TYPE.get(type) ?? { type, label: String(type) };
  const nextTile = {
    ...tile,
    ...(options.covered ? { covered: true } : {}),
  };

  return under ? { ...nextTile, under } : nextTile;
}

function cloneTileObject(tile) {
  if (!tile) {
    return null;
  }

  const under = tile.under ? cloneTileObject(tile.under) : null;
  return createTileByType(tile.type, under, { covered: tile.covered });
}

function createTileStack(types) {
  if (types.length === 1) {
    return createTileByType(types[0], null, { covered: true });
  }

  return types.reduce((under, type, index) => {
    const isBottomTile = index === 0;
    return createTileByType(type, under, { covered: isBottomTile });
  }, null);
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

function getTileStackKey(tile) {
  const parts = [];
  let current = tile;

  while (current) {
    parts.unshift(`${current.covered ? "covered:" : ""}${current.type}`);
    current = current.under;
  }

  return parts.join("/");
}

function countTileStack(tile) {
  let count = 0;
  let current = tile;

  while (current) {
    count += 1;
    current = current.under;
  }

  return count;
}

function revealNextTile(tile) {
  return tile?.under ? cloneTileObject(tile.under) : null;
}

function isVisibleTile(tile) {
  return Boolean(tile && !tile.covered);
}

function hasVisibleTiles(board) {
  return board.some((row) => row.some((tile) => isVisibleTile(tile)));
}

function revealCoveredTile(tile) {
  if (!tile) {
    return null;
  }

  const under = tile.under ? revealCoveredTile(tile.under) : null;
  return createTileByType(tile.type, under, { covered: false });
}

function revealCoveredLayer(board) {
  return board.map((row) => row.map((tile) => revealCoveredTile(tile)));
}

function cloneTile(type) {
  if (type === null) {
    return null;
  }

  if (Array.isArray(type)) {
    return createTileStack(type);
  }

  return createTileByType(type);
}

function createBoardFromTileTypes(
  tileTypes,
  positions,
  random = Math.random,
  rows = BOARD_SIZE,
  cols = BOARD_SIZE,
) {
  const board = createEmptyBoard(rows, cols);
  const shuffledTypes = shuffleArray(tileTypes, random);

  positions.forEach((position, index) => {
    board[position.row][position.col] = cloneTile(shuffledTypes[index]);
  });

  return board;
}

function createBoardFromLayout(layout) {
  if (!Array.isArray(layout) || layout.length === 0) {
    throw new Error("Board layout must have at least one row.");
  }

  const cols = layout[0]?.length ?? 0;

  if (cols === 0) {
    throw new Error("Board layout must have at least one column.");
  }

  return layout.map((row) => {
    if (!Array.isArray(row) || row.length !== cols) {
      throw new Error("Board layout rows must all have the same column count.");
    }

    return row.map((type) => cloneTile(type));
  });
}

function buildOccupancyGrid(board, endPosition) {
  const { rows, cols } = getBoardDimensions(board);
  const grid = Array.from({ length: rows + 2 }, () =>
    Array(cols + 2).fill(true),
  );

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      grid[row + 1][col + 1] = !isVisibleTile(board[row][col]);
    }
  }

  grid[endPosition.row + 1][endPosition.col + 1] = true;
  return grid;
}

function isInsidePaddedBoard(row, col, dimensions) {
  return (
    row >= 0 &&
    row < dimensions.rows + 2 &&
    col >= 0 &&
    col < dimensions.cols + 2
  );
}

export function isTileOpen(board, row, col) {
  if (!isVisibleTile(board[row]?.[col])) {
    return false;
  }

  const { rows, cols } = getBoardDimensions(board);

  return DIRECTIONS.some(([deltaRow, deltaCol]) => {
    const nextRow = row + deltaRow;
    const nextCol = col + deltaCol;

    if (nextRow < 0 || nextRow >= rows || nextCol < 0 || nextCol >= cols) {
      return true;
    }

    return !isVisibleTile(board[nextRow][nextCol]);
  });
}

export function hasPathWithinTwoTurns(board, startPosition, endPosition) {
  const dimensions = getBoardDimensions(board);
  const targetRow = endPosition.row + 1;
  const targetCol = endPosition.col + 1;
  const occupancy = buildOccupancyGrid(board, endPosition);
  const visited = Array.from({ length: dimensions.rows + 2 }, () =>
    Array.from({ length: dimensions.cols + 2 }, () =>
      Array(4).fill(Number.POSITIVE_INFINITY),
    ),
  );
  const queue = [
    {
      row: startPosition.row + 1,
      col: startPosition.col + 1,
      direction: -1,
      turns: 0,
    },
  ];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];

    for (let direction = 0; direction < DIRECTIONS.length; direction += 1) {
      const nextTurns =
        current.direction === -1 || current.direction === direction
          ? current.turns
          : current.turns + 1;

      if (nextTurns > MAX_TURNS) {
        continue;
      }

      let nextRow = current.row + DIRECTIONS[direction][0];
      let nextCol = current.col + DIRECTIONS[direction][1];

      while (
        isInsidePaddedBoard(nextRow, nextCol, dimensions) &&
        occupancy[nextRow][nextCol]
      ) {
        if (nextRow === targetRow && nextCol === targetCol) {
          return true;
        }

        if (visited[nextRow][nextCol][direction] > nextTurns) {
          visited[nextRow][nextCol][direction] = nextTurns;
          queue.push({
            row: nextRow,
            col: nextCol,
            direction,
            turns: nextTurns,
          });
        }

        nextRow += DIRECTIONS[direction][0];
        nextCol += DIRECTIONS[direction][1];
      }
    }
  }

  return false;
}

export function analyzePair(board, firstPosition, secondPosition) {
  if (
    !firstPosition ||
    !secondPosition ||
    (firstPosition.row === secondPosition.row &&
      firstPosition.col === secondPosition.col)
  ) {
    return { ok: false, reason: "same-tile" };
  }

  const firstTile = board[firstPosition.row]?.[firstPosition.col];
  const secondTile = board[secondPosition.row]?.[secondPosition.col];

  if (!isVisibleTile(firstTile) || !isVisibleTile(secondTile)) {
    return { ok: false, reason: "missing-tile" };
  }

  if (firstTile.type !== secondTile.type) {
    return { ok: false, reason: "different-tile" };
  }

  if (!isTileOpen(board, firstPosition.row, firstPosition.col)) {
    return { ok: false, reason: "first-tile-blocked" };
  }

  if (!isTileOpen(board, secondPosition.row, secondPosition.col)) {
    return { ok: false, reason: "second-tile-blocked" };
  }

  if (!hasPathWithinTwoTurns(board, firstPosition, secondPosition)) {
    return { ok: false, reason: "path-blocked" };
  }

  return {
    ok: true,
    tile: firstTile,
  };
}

export function removePair(board, firstPosition, secondPosition) {
  const nextBoard = board.map((row) => [...row]);
  nextBoard[firstPosition.row][firstPosition.col] = revealNextTile(
    board[firstPosition.row][firstPosition.col],
  );
  nextBoard[secondPosition.row][secondPosition.col] = revealNextTile(
    board[secondPosition.row][secondPosition.col],
  );

  if (!hasVisibleTiles(nextBoard)) {
    return revealCoveredLayer(nextBoard);
  }

  return nextBoard;
}

export function countRemainingTiles(board) {
  return board
    .flat()
    .reduce((total, tile) => total + countTileStack(tile), 0);
}

export function countRemainingPairs(board) {
  return countRemainingTiles(board) / 2;
}

export function findMoves(board, limit = Number.POSITIVE_INFINITY) {
  const groups = new Map();
  const moves = [];

  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      const tile = board[row][col];

      if (!isVisibleTile(tile) || !isTileOpen(board, row, col)) {
        continue;
      }

      if (!groups.has(tile.type)) {
        groups.set(tile.type, []);
      }

      groups.get(tile.type).push({ row, col });
    }
  }

  for (const positions of groups.values()) {
    for (let first = 0; first < positions.length; first += 1) {
      for (let second = first + 1; second < positions.length; second += 1) {
        if (hasPathWithinTwoTurns(board, positions[first], positions[second])) {
          moves.push({
            first: positions[first],
            second: positions[second],
          });
        }

        if (moves.length >= limit) {
          return moves;
        }
      }
    }
  }

  return moves;
}

function getBoardKey(board) {
  const { rows, cols } = getBoardDimensions(board);
  return board
    .flat()
    .map((tile) => (tile ? getTileStackKey(tile) : "__"))
    .join("|")
    .concat(`|${rows}x${cols}`);
}

function canSolveBoard(board, memo, state) {
  if (state.nodes > SOLVER_NODE_LIMIT) {
    return false;
  }

  const remainingTiles = countRemainingTiles(board);

  if (remainingTiles === 0) {
    return true;
  }

  const key = getBoardKey(board);

  if (memo.has(key)) {
    return memo.get(key);
  }

  state.nodes += 1;
  const moves = findMoves(board);

  for (const move of moves) {
    const nextBoard = removePair(board, move.first, move.second);

    if (canSolveBoard(nextBoard, memo, state)) {
      memo.set(key, true);
      return true;
    }
  }

  memo.set(key, false);
  return false;
}

export function isBoardSolvable(board) {
  return canSolveBoard(board, new Map(), { nodes: 0 });
}

function createRandomSolvableBoard(random = Math.random) {
  const positions = getFullBoardPositions();

  for (let attempt = 0; attempt < 600; attempt += 1) {
    const tileTypes = createTilePool(random);
    const board = createBoardFromTileTypes(tileTypes, positions, random);

    if (isBoardSolvable(board)) {
      return board;
    }
  }

  throw new Error("Unable to generate a solvable board.");
}

function recordMatchesDifficulty(record, difficultyRange) {
  if (!difficultyRange || !Number.isFinite(record?.difficulty)) {
    return true;
  }

  const minDifficulty = difficultyRange.min ?? 0;
  const maxDifficulty = difficultyRange.max ?? 100;
  return record.difficulty >= minDifficulty && record.difficulty <= maxDifficulty;
}

function getStageRecord(stageNumber) {
  if (!Number.isFinite(stageNumber)) {
    return null;
  }

  return (
    SOLVABLE_BOARDS.find((record) => record.stage?.number === stageNumber) ??
    null
  );
}

function createRecordResult(record) {
  if (!record) {
    return null;
  }

  const board = createBoardFromLayout(record.tiles);

  if (record.verified === true || isBoardSolvable(board)) {
    return { board, record };
  }

  return null;
}

export function createPlayableBoardRecord(
  random = Math.random,
  difficultyRange = null,
  stageNumber = null,
) {
  const stageResult = createRecordResult(getStageRecord(stageNumber));

  if (stageResult) {
    return stageResult;
  }

  const boardRecords = shuffleArray(
    SOLVABLE_BOARDS.filter((record) =>
      recordMatchesDifficulty(record, difficultyRange),
    ),
    random,
  );

  for (const record of boardRecords) {
    const result = createRecordResult(record);

    if (result) {
      return result;
    }
  }

  return {
    board: createRandomSolvableBoard(random),
    record: {
      id: "runtime-generated",
      difficulty: null,
      metrics: { generatedAtRuntime: true },
    },
  };
}
