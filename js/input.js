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

export function createInputController({ getState, requestRender, updateHud, showBuildMenu, hideBuildMenu, isPlayerTurn, animateMove }) {
  let selectedUnit = null;
  let mode = "idle"; // idle | selected | moving | postMove
  let reachable = new Map();
  let attackableKeys = new Set();
  let isAnimating = false;
  let lastMovePath = null; // 移動後キャンセル用の経路(反転して元の位置に戻す)

  // 移動後メニューでどの行動を選べるか(隣接する敵がいれば攻撃、占領可能地形にいれば占領)
  function computePostMoveOptions() {
    if (mode !== "postMove" || !selectedUnit) return null;
    const state = getState();
    const enemyFaction = opponentOf(selectedUnit.faction);
    const adjacentEnemies = ADJACENT_OFFSETS
      .map(([dr, dc]) => getUnitAt(state, selectedUnit.row + dr, selectedUnit.col + dc))
      .filter((u) => u && u.faction === enemyFaction);
    const terrain = terrainAt(state, selectedUnit.row, selectedUnit.col);
    const canCapture =
      UNIT_TYPES[selectedUnit.type].canCapture &&
      terrain.capturable &&
      ownerAt(state, selectedUnit.row, selectedUnit.col) !== selectedUnit.faction;

    return {
      canAttack: adjacentEnemies.length === 1,
      attackTarget: adjacentEnemies.length === 1 ? adjacentEnemies[0] : null,
      canCapture,
    };
  }

  function getUiState() {
    return {
      selectedUnitId: selectedUnit ? selectedUnit.id : null,
      reachable: mode === "postMove" || mode === "moving" ? null : reachable,
      attackableKeys: mode === "idle" || mode === "moving" ? null : attackableKeys,
      postMoveOptions: computePostMoveOptions(),
    };
  }

  function clearSelection() {
    selectedUnit = null;
    mode = "idle";
    reachable = new Map();
    attackableKeys = new Set();
    lastMovePath = null;
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
  }

  async function attemptMoveTo(state, row, col) {
    const path = reachable.get(tileKey(row, col)).path;
    const unit = selectedUnit;
    lastMovePath = path;
    mode = "moving";
    isAnimating = true;
    await animateMove(unit, path);
    isAnimating = false;
    if (selectedUnit !== unit) return; // 選択が解除されていたら何もしない

    moveSelectedTo(row, col);
    mode = "postMove";
    updateHud();
    requestRender(getUiState());
  }

  async function attemptAttackViaReposition(state, row, col, target) {
    const bestTile = findClosestReachableAdjacent(row, col);
    if (!bestTile) return false;
    const unit = selectedUnit;
    mode = "moving";
    isAnimating = true;
    await animateMove(unit, bestTile.path);
    isAnimating = false;
    if (selectedUnit !== unit) return true; // 選択が解除されていたら何もしない

    moveSelectedTo(bestTile.row, bestTile.col);
    resolveAttack(state, selectedUnit, target);
    finishUnitAction();
    return true;
  }

  function handleWait() {
    if (!selectedUnit || mode !== "postMove" || isAnimating) return;
    selectedUnit.moved = true;
    finishUnitAction();
  }

  function handleAttack() {
    if (!selectedUnit || mode !== "postMove" || isAnimating) return;
    const options = computePostMoveOptions();
    if (!options || !options.canAttack) return;
    const state = getState();
    resolveAttack(state, selectedUnit, options.attackTarget);
    finishUnitAction();
  }

  function handleCapture() {
    if (!selectedUnit || mode !== "postMove" || isAnimating) return;
    const options = computePostMoveOptions();
    if (!options || !options.canCapture) return;
    const state = getState();
    tryCapture(state, selectedUnit);
    finishUnitAction();
  }

  async function handleCancelMove() {
    if (!selectedUnit || mode !== "postMove" || isAnimating || !lastMovePath) return;
    const unit = selectedUnit;
    const [originRow, originCol] = lastMovePath[0];
    const reversePath = [...lastMovePath].reverse();

    mode = "moving";
    isAnimating = true;
    await animateMove(unit, reversePath);
    isAnimating = false;
    if (selectedUnit !== unit) return; // 選択が解除されていたら何もしない

    unit.row = originRow;
    unit.col = originCol;
    lastMovePath = null;
    const state = getState();
    selectUnit(state, unit);
  }

  function handleTileTap(row, col) {
    const state = getState();
    if (state.gameOver || !isPlayerTurn() || isAnimating) return;

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
    handleAttack,
    handleCapture,
    handleCancelMove,
    build,
    clearSelection,
    getUiState,
    isAnimating: () => isAnimating,
    isPostMove: () => mode === "postMove",
  };
}
