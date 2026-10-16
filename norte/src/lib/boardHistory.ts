import type { MissionProject } from "./projectStore";

export type BoardSnapshot = MissionProject["board"];

export type BoardHistory = {
  past: BoardSnapshot[];
  future: BoardSnapshot[];
};

export type BoardHistoryStep = {
  board: BoardSnapshot;
  history: BoardHistory;
};

const HISTORY_LIMIT = 80;

export function cloneBoardSnapshot(board: BoardSnapshot): BoardSnapshot {
  return {
    nodes: board.nodes.map((node) => ({ ...node })),
    links: board.links.map((link) => ({ ...link }))
  };
}

export function boardsEqual(left: BoardSnapshot, right: BoardSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createBoardHistory(): BoardHistory {
  return { past: [], future: [] };
}

export function recordBoardSnapshot(history: BoardHistory, board: BoardSnapshot): BoardHistory {
  const snapshot = cloneBoardSnapshot(board);
  const previous = history.past[history.past.length - 1];
  const past = previous && boardsEqual(previous, snapshot)
    ? history.past
    : [...history.past, snapshot].slice(-HISTORY_LIMIT);
  return { past, future: [] };
}

export function undoBoardChange(history: BoardHistory, currentBoard: BoardSnapshot): BoardHistoryStep | null {
  const previous = history.past[history.past.length - 1];
  if (!previous) return null;
  return {
    board: cloneBoardSnapshot(previous),
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, cloneBoardSnapshot(currentBoard)].slice(-HISTORY_LIMIT)
    }
  };
}

export function redoBoardChange(history: BoardHistory, currentBoard: BoardSnapshot): BoardHistoryStep | null {
  const next = history.future[history.future.length - 1];
  if (!next) return null;
  return {
    board: cloneBoardSnapshot(next),
    history: {
      past: [...history.past, cloneBoardSnapshot(currentBoard)].slice(-HISTORY_LIMIT),
      future: history.future.slice(0, -1)
    }
  };
}
