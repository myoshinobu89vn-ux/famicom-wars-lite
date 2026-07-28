// タップ操作の状態機械: ユニット選択 → 移動 → 攻撃/占領/待機、生産メニュー起動

import { UNIT_TYPES } from "./data.js";
import { computeReachable, tileKey } from "./grid.js";
import { getUnitAt, occupiedKeysExcluding, terrainAt, ownerAt, produceUnit, opponentOf } from "./state.js";
import { resolveAttack, tryCapture, isAdjacent } from "./combat.js";

const ADJACENT_OFFSETS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

export function createInputController({ getState, requestRender, updateHud, showBuildMenu, hideBuildMenu, isPlayerTurn }) {
  let selectedUnit = null;
  let mode = "idle"; // idle | selected | postMove
  let reachable = new Map();
  let attackableKeys = new Set();

  function getUiState() {
    return {
      selectedUnitId: selectedUnit ? selectedUnit.id : null,
      reachable: mode === "postMove" ? null : reachable,
      attackableKeys: mode === "idle" ? null : attackableKeys,
    };
  }

  function clearSelection() {
    selectedUnit = null;
    mode = "idle";
    reachable = new Map();
    attackableKeys = new Set();
    hideBuildMenu();
  }

  function computeAttackable(state, unit, reach) {
    const keys = new Set();
    const enemyFaction = opponentOf(unit.faction);
    for (const { row, col } of reach.values()) {
      for (const [dr, dc] of ADJACENT_OFFSETS) {
        const target = getUnitAt(state, row + dr, col + dc);
        if (target && target.faction === enemyFaction) keys.add(tileKey(row + dr, col + dc));
      }
    }
    return keys;
  }

  function selectUnit(state, unit) {
    selectedUnit = unit;
    mode = "selected";
    const occupied = occupiedKeysExcluding(state, unit.id);
    reachable = computeReachable(state.map, occupied, unit.type, unit.row, unit.col, UNIT_TYPES[unit.type].move);
    attackableKeys = computeAttackable(state, unit, reachable);
    hideBuildMenu();
    updateHud();
    requestRender(getUiState());
  }

  function finishUnitAction() {
    clearSelection();
    updateHud();
    requestRender(getUiState());
  }

  function findClosestReachableAdjacent(row, col) {
    let best = null;
    for (const entry of reachable.values()) {
      if (Math.abs(entry.row - row) + Math.abs(entry.col - col) === 1) {
        if (!best || entry.cost < best.cost) best = entry;
      }
    }
    return best;
  }

  function moveSelectedTo(row, col) {
    selectedUnit.row = row;
    selectedUnit.col = col;
    selectedUnit.moved = true;
  }

  function attemptMoveTo(state, row, col) {
    moveSelectedTo(row, col);

    if (tryCapture(state, selectedUnit)) {
      finishUnitAction();
      return;
    }

    const enemyFaction = opponentOf(selectedUnit.faction);
    const hasAdjacentEnemy = ADJACENT_OFFSETS.some(([dr, dc]) => {
      const u = getUnitAt(state, row + dr, col + dc);
      return u && u.faction === enemyFaction;
    });

    if (hasAdjacentEnemy) {
      mode = "postMove";
      updateHud();
      requestRender(getUiState());
    } else {
      finishUnitAction();
    }
  }

  function attemptAttackViaReposition(state, row, col, target) {
    const bestTile = findClosestReachableAdjacent(row, col);
    if (!bestTile) return false;
    moveSelectedTo(bestTile.row, bestTile.col);
    resolveAttack(state, selectedUnit, target);
    finishUnitAction();
    return true;
  }

  function handleWait() {
    if (!selectedUnit) return;
    finishUnitAction();
  }

  function handleTileTap(row, col) {
    const state = getState();
    if (state.gameOver || !isPlayerTurn()) return;

    if (mode === "postMove") {
      if (selectedUnit.row === row && selectedUnit.col === col) {
        handleWait();
        return;
      }
      const target = getUnitAt(state, row, col);
      if (target && target.faction === opponentOf(selectedUnit.faction) && isAdjacent(selectedUnit, { row, col })) {
        resolveAttack(state, selectedUnit, target);
        finishUnitAction();
      }
      return;
    }

    const unitHere = getUnitAt(state, row, col);

    if (selectedUnit) {
      if (unitHere && unitHere.faction === opponentOf(selectedUnit.faction) && attackableKeys.has(tileKey(row, col))) {
        attemptAttackViaReposition(state, row, col, unitHere);
        return;
      }
      if (!unitHere && reachable.has(tileKey(row, col))) {
        attemptMoveTo(state, row, col);
        return;
      }
    }

    if (unitHere && unitHere.faction === "player" && !unitHere.moved) {
      selectUnit(state, unitHere);
      return;
    }

    if (!unitHere) {
      const terrain = terrainAt(state, row, col);
      if (terrain.producible && ownerAt(state, row, col) === "player") {
        clearSelection();
        showBuildMenu({ row, col });
        requestRender(getUiState());
        return;
      }
    }

    clearSelection();
    requestRender(getUiState());
  }

  function build(type, tile) {
    const state = getState();
    const unit = produceUnit(state, "player", type, tile.row, tile.col);
    hideBuildMenu();
    updateHud();
    requestRender(getUiState());
    return unit;
  }

  return {
    handleTileTap,
    handleWait,
    build,
    clearSelection,
    getUiState,
    isPostMove: () => mode === "postMove",
  };
}
