// CPU側のルールベースAI

import { UNIT_TYPES, TERRAIN, MAP_ROWS, MAP_COLS } from "./data.js";
import { computeReachable, manhattan, tileKey } from "./grid.js";
import {
  occupiedKeysExcluding,
  terrainAt,
  ownerAt,
  getUnitAt,
  producibleTilesFor,
  produceUnit,
  opponentOf,
} from "./state.js";
import { resolveAttack, tryCapture } from "./combat.js";

function findBestAttack(state, unit, reachable) {
  const enemyFaction = opponentOf(unit.faction);
  const unitDef = UNIT_TYPES[unit.type];
  let best = null;

  for (const entry of reachable.values()) {
    const { row, col } = entry;
    const candidates = [
      [row - 1, col],
      [row + 1, col],
      [row, col - 1],
      [row, col + 1],
    ];
    for (const [tr, tc] of candidates) {
      if (tr < 0 || tr >= MAP_ROWS || tc < 0 || tc >= MAP_COLS) continue;
      const target = getUnitAt(state, tr, tc);
      if (!target || target.faction !== enemyFaction) continue;
      const damage = Math.max(1, unitDef.power - terrainAt(state, tr, tc).defense);
      const isKill = damage >= target.hp;
      if (
        !best ||
        (isKill && !best.isKill) ||
        (isKill === best.isKill && damage > best.damage)
      ) {
        best = { entry, target, damage, isKill };
      }
    }
  }
  return best;
}

function findCaptureTarget(state, unit, reachable) {
  if (!UNIT_TYPES[unit.type].canCapture) return null;
  let best = null;
  for (const entry of reachable.values()) {
    const terrain = terrainAt(state, entry.row, entry.col);
    if (!terrain.capturable) continue;
    if (ownerAt(state, entry.row, entry.col) === unit.faction) continue;
    if (!best || entry.cost < best.cost) best = entry;
  }
  return best;
}

function collectAdvanceTargets(state, faction) {
  const enemyFaction = opponentOf(faction);
  const targets = [];
  for (const u of state.units) {
    if (u.faction === enemyFaction && u.hp > 0) targets.push({ row: u.row, col: u.col });
  }
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const terrain = TERRAIN[state.map[r][c]];
      if (terrain.capturable && state.ownership[r][c] !== faction) {
        targets.push({ row: r, col: c });
      }
    }
  }
  return targets;
}

function moveToward(unit, reachable, target) {
  let best = null;
  for (const entry of reachable.values()) {
    const dist = manhattan(entry, target);
    if (!best || dist < best.dist) best = { entry, dist };
  }
  return best ? best.entry : null;
}

export async function runCpuTurn(state, animateMove = async () => {}) {
  const faction = "cpu";
  const units = state.units.filter((u) => u.faction === faction && u.hp > 0);

  for (const unit of units) {
    if (unit.hp <= 0) continue; // 途中で反撃死している可能性
    const movePoints = UNIT_TYPES[unit.type].move;
    const occupied = occupiedKeysExcluding(state, unit.id);
    const reachable = computeReachable(state.map, occupied, unit.type, unit.row, unit.col, movePoints);

    const attack = findBestAttack(state, unit, reachable);
    if (attack) {
      await animateMove(unit, attack.entry.path);
      unit.row = attack.entry.row;
      unit.col = attack.entry.col;
      resolveAttack(state, unit, attack.target);
      continue;
    }

    const captureTile = findCaptureTarget(state, unit, reachable);
    if (captureTile) {
      await animateMove(unit, captureTile.path);
      unit.row = captureTile.row;
      unit.col = captureTile.col;
      tryCapture(state, unit);
      continue;
    }

    const targets = collectAdvanceTargets(state, faction);
    if (targets.length > 0) {
      targets.sort((a, b) => manhattan(unit, a) - manhattan(unit, b));
      const nearestTarget = targets[0];
      const stepTile = moveToward(unit, reachable, nearestTarget);
      if (stepTile) {
        await animateMove(unit, stepTile.path);
        unit.row = stepTile.row;
        unit.col = stepTile.col;
      }
    }
    unit.moved = true;
  }

  for (const tile of producibleTilesFor(state, faction)) {
    if (state.money[faction] >= UNIT_TYPES.tank.cost) {
      produceUnit(state, faction, "tank", tile.row, tile.col);
    } else if (state.money[faction] >= UNIT_TYPES.soldier.cost) {
      produceUnit(state, faction, "soldier", tile.row, tile.col);
    }
  }
}
