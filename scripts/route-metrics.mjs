// Route/smoke helpers shared by generate-solvable-boards.mjs and
// verify-solvable-boards.mjs so the rules can never drift apart.
import { analyzePair, findMoves, removePair } from "../src/game.js";

export const ROUTE_LIMIT_BY_SUBSTAGE = [400, 200, 100, 60, 30, 15, 8, 4, 2, 1];

export function getSmokeStartStage(world) {
  if (world <= 1) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(1, 11 - world);
}

export function factorial(value) {
  let result = 1;

  for (let index = 2; index <= value; index += 1) {
    result *= index;
  }

  return result;
}

export function samePosition(left, right) {
  return left?.row === right?.row && left?.col === right?.col;
}

export function sameMove(left, right) {
  return (
    (samePosition(left.first, right.first) && samePosition(left.second, right.second)) ||
    (samePosition(left.first, right.second) && samePosition(left.second, right.first))
  );
}

export function sameRouteStep(step, move, board) {
  const tile = board[move.first.row]?.[move.first.col];

  if (!tile || step.type !== tile.type) {
    return false;
  }

  return sameMove(step, move);
}

export function calculateSmokeMetrics(board, routePlan, routeGroupSizes) {
  let currentBoard = board;
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
