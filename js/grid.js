// グリッド座標ユーティリティ・移動範囲計算(Dijkstra)

import { MAP_ROWS, MAP_COLS, TERRAIN } from "./data.js";

export function inBounds(row, col) {
  return row >= 0 && row < MAP_ROWS && col >= 0 && col < MAP_COLS;
}

export function tileKey(row, col) {
  return `${row},${col}`;
}

export function neighborsOf(row, col) {
  return [
    [row - 1, col],
    [row + 1, col],
    [row, col - 1],
    [row, col + 1],
  ].filter(([r, c]) => inBounds(r, c));
}

export function manhattan(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

/**
 * 指定ユニットが今ターン移動できるタイルを Dijkstra で求める。
 * occupiedKeys: 他ユニットが立っているタイル(移動不可、通過も不可、開始地点は除く)
 * 戻り値: Map<tileKey, { row, col, cost, path: [[row,col], ...] }>  (start を含む)
 */
export function computeReachable(map, occupiedKeys, unitTypeId, startRow, startCol, movePoints) {
  const start = { row: startRow, col: startCol, cost: 0, path: [[startRow, startCol]] };
  const result = new Map();
  result.set(tileKey(startRow, startCol), start);

  // 単純な優先度キュー代わりの配列(マップが小さいため線形探索で十分)
  const frontier = [start];

  while (frontier.length > 0) {
    frontier.sort((a, b) => a.cost - b.cost);
    const current = frontier.shift();
    const currentKey = tileKey(current.row, current.col);
    if (result.get(currentKey) !== current) continue; // 既により良い経路で更新済み

    for (const [nr, nc] of neighborsOf(current.row, current.col)) {
      const key = tileKey(nr, nc);
      if (occupiedKeys.has(key)) continue; // 他ユニットが占有(通過不可)
      const terrain = TERRAIN[map[nr][nc]];
      const stepCost = terrain.moveCost[unitTypeId];
      if (!isFinite(stepCost)) continue; // 進入不可地形
      const newCost = current.cost + stepCost;
      if (newCost > movePoints) continue;
      const existing = result.get(key);
      if (!existing || newCost < existing.cost) {
        const entry = {
          row: nr,
          col: nc,
          cost: newCost,
          path: [...current.path, [nr, nc]],
        };
        result.set(key, entry);
        frontier.push(entry);
      }
    }
  }

  return result;
}
