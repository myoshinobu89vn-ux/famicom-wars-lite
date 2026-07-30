// CPU側AI: AIController が状況分析を行い、評価値方式で各ユニットの行動と生産を決定する

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

// AIの判断理由をブラウザのコンソール(devtools)で確認できるようにするフラグ
const AI_DEBUG = true;

// 評価値表: 各行動のスコアリング基準
const SCORE = {
  CAPTURE_CITY: 80,
  CAPTURE_CAPITAL_BONUS: 60, // 敵首都を占領できる場合はさらに加点(勝利に直結するため)
  KILL_ENEMY: 50,
  DAMAGE_ENEMY_SCALE: 30, // 撃破に至らない攻撃は与ダメージの割合に応じて加点
  SOFT_TARGET_BONUS: 30, // 戦車が歩兵だけの相手を攻撃する際の加点
  APPROACH_ENEMY_CAPITAL: 70,
  APPROACH_TARGET_STEP: 8, // 前進で目標に1マス近づくごとの基礎加点
  RISK_LOSS_PENALTY: -60, // 反撃で自軍が撃破される見込みの行動への減点
  RISK_TRADE_PENALTY: -30, // 反撃ダメージが与ダメージを上回る不利な交換への減点
  POINTLESS_MOVE: -20, // 目標に近づかない・意味の薄い移動
  DEFENSIVE_REPOSITION: 70, // 危険な位置から防御適地への退避
  WAIT: 0,
};

const ADJACENT_OFFSETS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

function logDecision(unit, label, score, detail) {
  if (!AI_DEBUG) return;
  const tag = `${UNIT_TYPES[unit.type].label}#${unit.id}`;
  console.debug(`[AI] ${tag}: ${label} 評価${score}${detail ? ` (${detail})` : ""}`);
}

// 攻撃側の種別と防御側の地形防御力からダメージを算出する(combat.js の resolveAttack と同じ式)
function computeDamage(attackerTypeId, defenderTerrainDefense) {
  return Math.max(1, UNIT_TYPES[attackerTypeId].power - defenderTerrainDefense);
}

// ターン開始時の状況分析。以降の全ユニット・生産判断で使い回す
function analyzeSituation(state, faction) {
  const enemyFaction = opponentOf(faction);
  const ownUnits = state.units.filter((u) => u.faction === faction && u.hp > 0);
  const enemyUnits = state.units.filter((u) => u.faction === enemyFaction && u.hp > 0);
  const enemyCapital = state.capitalLocation[enemyFaction];

  const captureTargets = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const terrain = TERRAIN[state.map[r][c]];
      if (terrain.capturable && state.ownership[r][c] !== faction) {
        captureTargets.push({
          row: r,
          col: c,
          isEnemyCapital: r === enemyCapital.row && c === enemyCapital.col,
        });
      }
    }
  }

  return {
    faction,
    enemyFaction,
    ownUnits,
    enemyUnits,
    captureTargets,
    enemyCapital,
    ownCapital: state.capitalLocation[faction],
    money: state.money[faction],
    enemyTankCount: enemyUnits.filter((u) => u.type === "tank").length,
    enemySoldierCount: enemyUnits.filter((u) => u.type === "soldier").length,
    ownTankCount: ownUnits.filter((u) => u.type === "tank").length,
    ownSoldierCount: ownUnits.filter((u) => u.type === "soldier").length,
  };
}

// destRow,destCol に移動した場合、隣接する敵ユニットからどれだけ反撃を受けうるかを見積もる
function assessDestinationRisk(state, unit, destRow, destCol, enemyUnits) {
  let worstDamage = 0;
  for (const enemy of enemyUnits) {
    if (Math.abs(enemy.row - destRow) + Math.abs(enemy.col - destCol) !== 1) continue;
    const dmg = computeDamage(enemy.type, terrainAt(state, destRow, destCol).defense);
    if (dmg > worstDamage) worstDamage = dmg;
  }
  if (worstDamage <= 0) return { penalty: 0, note: null };
  if (worstDamage >= unit.hp) return { penalty: SCORE.RISK_LOSS_PENALTY, note: "反撃で撃破される恐れ" };
  return { penalty: Math.round(SCORE.RISK_TRADE_PENALTY * (worstDamage / unit.hp)), note: "反撃リスクあり" };
}

// 攻撃候補: 到達可能な各マスから隣接する敵ユニットを攻撃する行動
function generateAttackCandidates(state, unit, reachable, ctx) {
  const candidates = [];

  for (const entry of reachable.values()) {
    for (const [dr, dc] of ADJACENT_OFFSETS) {
      const tr = entry.row + dr;
      const tc = entry.col + dc;
      const target = getUnitAt(state, tr, tc);
      if (!target || target.faction !== ctx.enemyFaction) continue;

      const damage = computeDamage(unit.type, terrainAt(state, tr, tc).defense);
      const isLethal = damage >= target.hp;

      let score = isLethal ? SCORE.KILL_ENEMY : Math.round(SCORE.DAMAGE_ENEMY_SCALE * (damage / target.hp));
      let detail = isLethal ? "敵撃破" : `ダメージ${damage}`;

      if (unit.type === "tank" && target.type === "soldier") {
        score += SCORE.SOFT_TARGET_BONUS;
        detail += ", 歩兵のみの守り";
      }

      if (!isLethal) {
        const counterDamage = computeDamage(target.type, terrainAt(state, entry.row, entry.col).defense);
        if (counterDamage >= unit.hp) {
          score += SCORE.RISK_LOSS_PENALTY;
          detail += ", 反撃で撃破される恐れ";
        } else if (counterDamage > damage) {
          score += SCORE.RISK_TRADE_PENALTY;
          detail += ", 不利な交換";
        }
      }

      candidates.push({
        kind: "attack",
        entry,
        target,
        score,
        label: `敵ユニット(${tr},${tc})を攻撃`,
        detail,
      });
    }
  }
  return candidates;
}

// 占領候補: 到達可能な範囲にある未占領の占領可能地形へ移動して占領する行動(歩兵のみ)
function generateCaptureCandidates(state, unit, reachable, ctx) {
  if (!UNIT_TYPES[unit.type].canCapture) return [];
  const candidates = [];

  for (const entry of reachable.values()) {
    const terrain = terrainAt(state, entry.row, entry.col);
    if (!terrain.capturable) continue;
    if (ownerAt(state, entry.row, entry.col) === unit.faction) continue;

    const isEnemyCapital = entry.row === ctx.enemyCapital.row && entry.col === ctx.enemyCapital.col;
    let score = SCORE.CAPTURE_CITY + (isEnemyCapital ? SCORE.CAPTURE_CAPITAL_BONUS : 0);
    let detail = isEnemyCapital ? "敵首都占領" : "都市占領";

    // 敵首都の占領はその場で勝利確定となるため、占領後のリスクは評価しない
    if (!isEnemyCapital) {
      const risk = assessDestinationRisk(state, unit, entry.row, entry.col, ctx.enemyUnits);
      score += risk.penalty;
      if (risk.note) detail += `, ${risk.note}`;
    }

    candidates.push({
      kind: "capture",
      entry,
      score,
      label: `(${entry.row},${entry.col})へ移動して占領`,
      detail,
    });
  }
  return candidates;
}

// 前進候補: 攻撃・占領ができない場合に、役割に応じた戦略目標へ近づく行動
// 歩兵は未占領の占領可能地形を、戦車は敵主力(歩兵のみの相手を優先)や敵首都を目標にする
function generateAdvanceCandidate(state, unit, reachable, ctx) {
  const targets = [];

  if (unit.type === "soldier") {
    for (const t of ctx.captureTargets) {
      targets.push({
        row: t.row,
        col: t.col,
        weight: t.isEnemyCapital ? SCORE.APPROACH_ENEMY_CAPITAL : SCORE.APPROACH_TARGET_STEP,
      });
    }
  } else {
    for (const enemy of ctx.enemyUnits) {
      const weight =
        enemy.type === "soldier" ? SCORE.APPROACH_TARGET_STEP + SCORE.SOFT_TARGET_BONUS / 4 : SCORE.APPROACH_TARGET_STEP;
      targets.push({ row: enemy.row, col: enemy.col, weight });
    }
    targets.push({ row: ctx.enemyCapital.row, col: ctx.enemyCapital.col, weight: SCORE.APPROACH_ENEMY_CAPITAL });
  }

  if (targets.length === 0) return null;

  targets.sort((a, b) => manhattan(unit, a) - manhattan(unit, b));
  const target = targets[0];
  const oldDist = manhattan(unit, target);

  let best = null;
  for (const entry of reachable.values()) {
    const dist = manhattan(entry, target);
    if (!best || dist < best.dist) best = { entry, dist };
  }
  if (!best) return null;

  const improvement = oldDist - best.dist;
  let score;
  let detail;
  if (improvement > 0) {
    score = Math.round(target.weight * improvement);
    detail = `目標(${target.row},${target.col})に${improvement}マス接近`;
  } else {
    score = SCORE.POINTLESS_MOVE;
    detail = "目標に近づけない";
  }

  const risk = assessDestinationRisk(state, unit, best.entry.row, best.entry.col, ctx.enemyUnits);
  score += risk.penalty;
  if (risk.note) detail += `, ${risk.note}`;

  return {
    kind: "move",
    entry: best.entry,
    score,
    label: `(${best.entry.row},${best.entry.col})へ前進`,
    detail,
  };
}

// 防御候補: 現在地が敵に狙われている場合、より安全・高防御な到達可能マスへ退避する
function generateDefensiveCandidate(state, unit, reachable, ctx) {
  const currentRisk = assessDestinationRisk(state, unit, unit.row, unit.col, ctx.enemyUnits);
  if (currentRisk.penalty >= 0) return null; // 今の場所が危険でなければ退避は不要

  let best = null;
  for (const entry of reachable.values()) {
    const terrain = terrainAt(state, entry.row, entry.col);
    const risk = assessDestinationRisk(state, unit, entry.row, entry.col, ctx.enemyUnits);
    const safetyScore = terrain.defense * 10 + risk.penalty;
    if (!best || safetyScore > best.safetyScore) best = { entry, safetyScore, risk };
  }
  if (!best || best.risk.penalty >= currentRisk.penalty) return null; // より安全な場所が無ければ却下

  return {
    kind: "move",
    entry: best.entry,
    score: SCORE.DEFENSIVE_REPOSITION + best.risk.penalty,
    label: `(${best.entry.row},${best.entry.col})へ防衛配置`,
    detail: "危険な位置からの退避",
  };
}

function generateWaitCandidate(unit, reachable) {
  return {
    kind: "wait",
    entry: reachable.get(tileKey(unit.row, unit.col)),
    score: SCORE.WAIT,
    label: "待機",
    detail: "有効な行動なし",
  };
}

// ユニット1体分の行動を評価値方式で決定する(候補を全て生成し、最高評価を採用)
function decideUnitAction(state, unit, situation) {
  const movePoints = UNIT_TYPES[unit.type].move;
  const occupied = occupiedKeysExcluding(state, unit.id);
  const reachable = computeReachable(state.map, occupied, unit.type, unit.row, unit.col, movePoints);

  // 同ターン内で他ユニットが倒した敵を誤って標的にしないよう、敵情報は都度最新化する
  const liveEnemyUnits = state.units.filter((u) => u.faction === situation.enemyFaction && u.hp > 0);
  const ctx = { ...situation, enemyUnits: liveEnemyUnits };

  const candidates = [
    ...generateAttackCandidates(state, unit, reachable, ctx),
    ...generateCaptureCandidates(state, unit, reachable, ctx),
  ];

  const advance = generateAdvanceCandidate(state, unit, reachable, ctx);
  if (advance) candidates.push(advance);

  const defend = generateDefensiveCandidate(state, unit, reachable, ctx);
  if (defend) candidates.push(defend);

  candidates.push(generateWaitCandidate(unit, reachable));

  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates[0];
  logDecision(unit, chosen.label, chosen.score, chosen.detail);
  return chosen;
}

async function executeUnitAction(state, unit, action, animateMove) {
  await animateMove(unit, action.entry.path);
  unit.row = action.entry.row;
  unit.col = action.entry.col;

  if (action.kind === "attack") {
    resolveAttack(state, unit, action.target);
  } else if (action.kind === "capture") {
    tryCapture(state, unit);
  }
  unit.moved = true;
}

// 工場・首都での生産を状況に応じて決定する(資金・敵戦力・序盤かどうかを考慮)
function decideAndRunProduction(state, situation) {
  const faction = situation.faction;
  const isEarlyGame = state.turn <= 3;

  for (const tile of producibleTilesFor(state, faction)) {
    const canAffordTank = state.money[faction] >= UNIT_TYPES.tank.cost;
    const canAffordSoldier = state.money[faction] >= UNIT_TYPES.soldier.cost;
    if (!canAffordTank && !canAffordSoldier) {
      if (AI_DEBUG) console.debug(`[AI] 生産(${tile.row},${tile.col}): 見送り (資金不足)`);
      continue;
    }

    // 敵戦車の数が自軍を上回っていれば対抗して戦車を優先する
    const needsTankCounter = situation.enemyTankCount > situation.ownTankCount;

    let type;
    let reason;
    if (isEarlyGame && canAffordSoldier && !needsTankCounter) {
      type = "soldier";
      reason = "序盤は歩兵で領土拡大を優先";
    } else if (canAffordTank && (needsTankCounter || !isEarlyGame)) {
      type = "tank";
      reason = needsTankCounter ? "敵戦車に対抗" : "戦力強化";
    } else if (canAffordSoldier) {
      type = "soldier";
      reason = "資金不足のため歩兵を生産";
    } else {
      continue;
    }

    const unit = produceUnit(state, faction, type, tile.row, tile.col);
    if (unit) {
      if (AI_DEBUG) {
        console.debug(`[AI] 生産(${tile.row},${tile.col}): ${UNIT_TYPES[type].label}を生産 (${reason})`);
      }
      if (type === "tank") situation.ownTankCount += 1;
      else situation.ownSoldierCount += 1;
    }
  }
}

// AI司令部: ターン開始時に状況分析を行い、各ユニットの役割と評価値に基づいて行動する
function createAIController(state, faction) {
  const situation = analyzeSituation(state, faction);

  async function takeTurn(animateMove) {
    if (AI_DEBUG) {
      console.debug(
        `[AI] === ターン${state.turn} ${faction}軍 状況分析 === 所持金${situation.money}G 自軍${situation.ownUnits.length}体 敵軍${situation.enemyUnits.length}体`
      );
    }

    for (const unit of situation.ownUnits) {
      if (unit.hp <= 0) continue; // 途中で反撃死している可能性
      const action = decideUnitAction(state, unit, situation);
      await executeUnitAction(state, unit, action, animateMove);
    }

    decideAndRunProduction(state, situation);
  }

  return { faction, situation, takeTurn };
}

export async function runCpuTurn(state, animateMove = async () => {}) {
  const controller = createAIController(state, "cpu");
  await controller.takeTurn(animateMove);
}
