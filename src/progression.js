export const TOTAL_WORLDS = 10;
export const STAGES_PER_WORLD = 10;
export const TOTAL_STAGES = TOTAL_WORLDS * STAGES_PER_WORLD;

const STORAGE_KEY = "sichuanp.currentStageNumber";
const COMPLETED_STORAGE_KEY = "sichuanp.completedStageNumber";

export function clampStageNumber(value) {
  const stageNumber = Number.parseInt(value, 10);

  if (!Number.isFinite(stageNumber)) {
    return 1;
  }

  return Math.min(TOTAL_STAGES, Math.max(1, stageNumber));
}

export function getStageInfo(stageNumber) {
  const number = clampStageNumber(stageNumber);
  const world = Math.floor((number - 1) / STAGES_PER_WORLD) + 1;
  const stage = ((number - 1) % STAGES_PER_WORLD) + 1;

  return {
    number,
    world,
    stage,
    label: `${world}-${stage}`,
    difficulty: number,
    isFinal: number === TOTAL_STAGES,
  };
}

export function getNextStageNumber(stageNumber) {
  const number = clampStageNumber(stageNumber);
  return number < TOTAL_STAGES ? number + 1 : null;
}

function getStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readSavedStageNumber() {
  const storage = getStorage();

  if (!storage) {
    return 1;
  }

  return clampStageNumber(storage.getItem(STORAGE_KEY));
}

export function readCompletedStageNumber() {
  const storage = getStorage();

  if (!storage) {
    return 0;
  }

  const completedStageNumber = Number.parseInt(
    storage.getItem(COMPLETED_STORAGE_KEY),
    10,
  );

  if (Number.isFinite(completedStageNumber)) {
    return Math.min(TOTAL_STAGES, Math.max(0, completedStageNumber));
  }

  return Math.max(0, readSavedStageNumber() - 1);
}

export function saveStageNumber(stageNumber) {
  const storage = getStorage();

  if (!storage) {
    return;
  }

  storage.setItem(STORAGE_KEY, String(clampStageNumber(stageNumber)));
}

export function saveCompletedStageNumber(stageNumber) {
  const storage = getStorage();

  if (!storage) {
    return;
  }

  const completedStageNumber = Math.min(
    TOTAL_STAGES,
    Math.max(readCompletedStageNumber(), clampStageNumber(stageNumber)),
  );

  storage.setItem(COMPLETED_STORAGE_KEY, String(completedStageNumber));
}
