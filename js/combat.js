// 戦闘・占領・勝敗判定ロジック

import { UNIT_TYPES } from "./data.js";
import { terrainAt, removeUnit, checkGameOver } from "./state.js";

export function isAdjacent(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

/**
 * attacker が defender を攻撃する。防御側が生き残れば1回だけ反撃する。
 * 戻り値: { damage, counterDamage, defenderDied, attackerDied }
 */
export function resolveAttack(state, attacker, defender) {
  const attackerDef = UNIT_TYPES[attacker.type];
  const defenderDef = UNIT_TYPES[defender.type];

  const damage = Math.max(1, attackerDef.power - terrainAt(state, defender.row, defender.col).defense);
  defender.hp -= damage;
  let defenderDied = false;
  let attackerDied = false;
  let counterDamage = 0;

  if (defender.hp <= 0) {
    defenderDied = true;
    removeUnit(state, defender.id);
  } else {
    counterDamage = Math.max(1, defenderDef.power - terrainAt(state, attacker.row, attacker.col).defense);
    attacker.hp -= counterDamage;
    if (attacker.hp <= 0) {
      attackerDied = true;
      removeUnit(state, attacker.id);
    }
  }

  attacker.acted = true;
  attacker.moved = true;
  checkGameOver(state);

  return { damage, counterDamage, defenderDied, attackerDied };
}

/**
 * unit が現在いるタイルを占領する(兵士のみ、占領可能地形のみ)。
 * 戻り値: true なら占領成立(勝敗判定含む)
 */
export function tryCapture(state, unit) {
  const unitDef = UNIT_TYPES[unit.type];
  const terrain = terrainAt(state, unit.row, unit.col);
  if (!unitDef.canCapture || !terrain.capturable) return false;
  if (state.ownership[unit.row][unit.col] === unit.faction) return false;

  state.ownership[unit.row][unit.col] = unit.faction;
  unit.acted = true;
  unit.moved = true;
  checkGameOver(state);
  return true;
}
