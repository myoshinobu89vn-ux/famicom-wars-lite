// ゲーム状態(マップ所有権・ユニット・資金・ターン)の管理

import { buildMap, TERRAIN, UNIT_TYPES, INITIAL_SETUP, STARTING_MONEY, MAP_ROWS, MAP_COLS } from "./data.js";
import { tileKey } from "./grid.js";

let nextUnitId = 1;

export function createInitialState() {
  const map = buildMap();
  const ownership = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(null));

  const state = {
    map,
    ownership,
    units: [],
    money: { player: STARTING_MONEY, cpu: STARTING_MONEY },
    turn: 1,
    currentFaction: "player",
    capitalLocation: {
      player: { ...INITIAL_SETUP.player.capital },
      cpu: { ...INITIAL_SETUP.cpu.capital },
    },
    gameOver: null,
  };

  for (const faction of ["player", "cpu"]) {
    const setup = INITIAL_SETUP[faction];
    map[setup.capital.row][setup.capital.col] = "CAPITAL";
    map[setup.factory.row][setup.factory.col] = "FACTORY";
    ownership[setup.capital.row][setup.capital.col] = faction;
    ownership[setup.factory.row][setup.factory.col] = faction;
    for (const u of setup.units) {
      addUnit(state, faction, u.type, u.row, u.col);
    }
  }

  return state;
}

export function addUnit(state, faction, type, row, col) {
  const unit = {
    id: nextUnitId++,
    type,
    faction,
    row,
    col,
    hp: UNIT_TYPES[type].hp,
    moved: false,
    acted: false,
  };
  state.units.push(unit);
  return unit;
}

export function removeUnit(state, unitId) {
  state.units = state.units.filter((u) => u.id !== unitId);
}

export function getUnitAt(state, row, col) {
  return state.units.find((u) => u.row === row && u.col === col && u.hp > 0) || null;
}

export function occupiedKeysExcluding(state, unitId) {
  const keys = new Set();
  for (const u of state.units) {
    if (u.id !== unitId && u.hp > 0) keys.add(tileKey(u.row, u.col));
  }
  return keys;
}

export function terrainAt(state, row, col) {
  return TERRAIN[state.map[row][col]];
}

export function ownerAt(state, row, col) {
  return state.ownership[row][col];
}

export function incomeForFaction(state, faction) {
  let total = 0;
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (state.ownership[r][c] === faction) {
        total += TERRAIN[state.map[r][c]].income || 0;
      }
    }
  }
  return total;
}

export function resetUnitFlagsForFaction(state, faction) {
  for (const u of state.units) {
    if (u.faction === faction) {
      u.moved = false;
      u.acted = false;
    }
  }
}

export function opponentOf(faction) {
  return faction === "player" ? "cpu" : "player";
}

// 首都が奪われていれば勝敗を確定する
export function checkGameOver(state) {
  for (const faction of ["player", "cpu"]) {
    const cap = state.capitalLocation[faction];
    if (state.ownership[cap.row][cap.col] !== faction) {
      state.gameOver = { winner: opponentOf(faction), loser: faction };
      return state.gameOver;
    }
  }
  return null;
}

export function startTurn(state, faction) {
  state.money[faction] += incomeForFaction(state, faction);
  resetUnitFlagsForFaction(state, faction);
}

// 自軍が所有し、ユニットが乗っていない生産可能地形(工場・首都)を列挙
export function producibleTilesFor(state, faction) {
  const tiles = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const terrain = TERRAIN[state.map[r][c]];
      if (terrain.producible && state.ownership[r][c] === faction && !getUnitAt(state, r, c)) {
        tiles.push({ row: r, col: c });
      }
    }
  }
  return tiles;
}

// 資金が足りればユニットを生産する(生産直後は行動不可)
export function produceUnit(state, faction, type, row, col) {
  const cost = UNIT_TYPES[type].cost;
  if (state.money[faction] < cost) return null;
  state.money[faction] -= cost;
  const unit = addUnit(state, faction, type, row, col);
  unit.moved = true;
  unit.acted = true;
  return unit;
}
