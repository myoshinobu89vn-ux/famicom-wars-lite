// Canvas描画

import { MAP_ROWS, MAP_COLS, TERRAIN, UNIT_TYPES } from "./data.js";
import { tileKey } from "./grid.js";

const FACTION_COLOR = {
  player: "#2563eb",
  cpu: "#dc2626",
};

// canvas自身ではなく、親コンテナ(実際に使える表示領域)を基準にタイルサイズを決める
export function computeTileSize(container) {
  const availWidth = container.clientWidth;
  const availHeight = container.clientHeight;
  return Math.floor(Math.min(availWidth / MAP_COLS, availHeight / MAP_ROWS));
}

export function rowColToXY(row, col, tileSize) {
  return { x: col * tileSize, y: row * tileSize };
}

export function xyToRowCol(x, y, tileSize) {
  return { row: Math.floor(y / tileSize), col: Math.floor(x / tileSize) };
}

export function resizeCanvasForDpr(canvas, tileSize) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = tileSize * MAP_COLS;
  const cssHeight = tileSize * MAP_ROWS;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function drawScene(ctx, state, tileSize, ui) {
  const {
    selectedUnitId = null,
    reachable = null,
    attackableKeys = null,
    attackTargetKeys = null,
    animatingUnit = null,
  } = ui || {};

  ctx.clearRect(0, 0, MAP_COLS * tileSize, MAP_ROWS * tileSize);

  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const terrain = TERRAIN[state.map[r][c]];
      const { x, y } = rowColToXY(r, c, tileSize);
      ctx.fillStyle = terrain.color;
      ctx.fillRect(x, y, tileSize, tileSize);
      ctx.strokeStyle = "rgba(0,0,0,0.15)";
      ctx.strokeRect(x + 0.5, y + 0.5, tileSize - 1, tileSize - 1);

      const owner = state.ownership[r][c];
      if (owner) {
        ctx.fillStyle = FACTION_COLOR[owner];
        ctx.beginPath();
        ctx.arc(x + tileSize - 6, y + 6, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      const key = tileKey(r, c);
      if (reachable && reachable.has(key)) {
        ctx.fillStyle = "rgba(37, 99, 235, 0.35)";
        ctx.fillRect(x, y, tileSize, tileSize);
      }
      if (attackableKeys && attackableKeys.has(key)) {
        ctx.fillStyle = "rgba(220, 38, 38, 0.4)";
        ctx.fillRect(x, y, tileSize, tileSize);
      }
    }
  }

  for (const unit of state.units) {
    if (unit.hp <= 0) continue;
    const isAnimating = animatingUnit && animatingUnit.id === unit.id;
    const drawRow = isAnimating ? animatingUnit.row : unit.row;
    const drawCol = isAnimating ? animatingUnit.col : unit.col;
    const { x, y } = rowColToXY(drawRow, drawCol, tileSize);
    const cx = x + tileSize / 2;
    const cy = y + tileSize / 2;
    const radius = tileSize * 0.35;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = FACTION_COLOR[unit.faction];
    ctx.globalAlpha = unit.moved ? 0.55 : 1;
    ctx.fill();
    if (unit.id === selectedUnitId) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#facc15";
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#fff";
    ctx.font = `${Math.floor(tileSize * 0.35)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = unit.type === "soldier" ? "S" : "T";
    ctx.fillText(label, cx, cy);

    ctx.font = `${Math.floor(tileSize * 0.22)}px sans-serif`;
    ctx.fillStyle = "#111";
    ctx.fillText(String(unit.hp), cx, y + tileSize - Math.floor(tileSize * 0.14));
  }

  // 移動後、攻撃対象に選べるタイルへ枠囲いのカーソルを表示する(対象が1体でも複数でも)
  if (attackTargetKeys) {
    for (const key of attackTargetKeys) {
      const [r, c] = key.split(",").map(Number);
      const { x, y } = rowColToXY(r, c, tileSize);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#f87171";
      ctx.strokeRect(x + 2, y + 2, tileSize - 4, tileSize - 4);
    }
  }
}

export function unitCost(typeId) {
  return UNIT_TYPES[typeId].cost;
}
