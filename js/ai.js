// CPU側AI: AIController が状況分析→作戦モード決定を行い、評価値方式(+作戦補正)で
// 各ユニットの行動と生産を決定する

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
  factionStats,
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

// 作戦モード判定の閾値
const STRATEGY_THRESHOLDS = {
  CAPITAL_THREAT_DISTANCE: 3, // 自軍首都からこの距離以内に敵ユニットがいれば脅威とみなす
  WEAK_POWER_RATIO: 0.65, // 戦力比がこれ未満なら劣勢
  STRONG_POWER_RATIO: 1.4, // 戦力比がこれ以上なら優勢
  EXPAND_TERRITORY_MIN: 2, // 未占領地(中立/敵地)がこの数以上残っていれば拡大余地ありとみなす
};

// 作戦目標への貢献度(候補生成の構造は変えず、生成後に一律で加減点する)
const STRATEGY_BONUS = 50;
const STRATEGY_PENALTY = -30;

// 複数ユニット連携(作戦グループ)関連の設定
const SUPPORT_RANGE = 2; // この距離以内に生存中の味方がいれば「支援可能」とみなす
const DEFEND_GROUP_RADIUS = 4; // 自軍首都からこの距離以内のユニットを防衛/再建グループに含める
const GROUP_SCORE = {
  SAME_TARGET: 30, // 所属グループの目標へ近づく
  CLOSER_TO_ALLIES: 20, // 移動後、味方との距離が今より近くなる
  ISOLATED: -30, // 移動後、周囲に生存中の味方が誰もいない
  SUPPORTED: 20, // 移動後、周囲に生存中の味方が1体以上いる
  SOLO_ASSAULT: -50, // 孤立した状態での攻撃(単独突撃)への追加減点
};

const ADJACENT_OFFSETS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

function logStrategy(strategy) {
  if (!AI_DEBUG) return;
  const reasonLines = strategy.reasons.map((r) => `- ${r}`).join("\n");
  console.debug(`[AI Strategy]\nmode: ${strategy.mode}\nreason:\n${reasonLines}`);
}

function logDecision(unit, candidate, group) {
  if (!AI_DEBUG) return;
  const tag = `${UNIT_TYPES[unit.type].label}#${unit.id}${group ? ` [${group.label}]` : ""}`;
  const groupNoteText =
    candidate.groupNotes && candidate.groupNotes.length ? ` (${candidate.groupNotes.join(", ")})` : "";
  console.debug(
    `[AI Decision] ${tag}:\n` +
      `${candidate.label}${candidate.detail ? ` (${candidate.detail})` : ""}\n` +
      `base score: ${candidate.baseScore}\n` +
      `strategy bonus: ${candidate.strategyBonus}\n` +
      `group bonus: ${candidate.groupBonus}${groupNoteText}\n` +
      `total: ${candidate.score}`
  );
}

function logGroups(groups) {
  if (!AI_DEBUG || groups.length === 0) return;
  for (const g of groups) {
    const memberLines = g.members.map((u) => `- ${UNIT_TYPES[u.type].label}#${u.id}`).join("\n");
    console.debug(`[AI Group] ${g.label}\nMembers:\n${memberLines}\nTarget:\n${g.target.label}(${g.target.row},${g.target.col})`);
  }
}

// 攻撃側の種別と防御側の地形防御力からダメージを算出する(combat.js の resolveAttack と同じ式)
function computeDamage(attackerTypeId, defenderTerrainDefense) {
  return Math.max(1, UNIT_TYPES[attackerTypeId].power - defenderTerrainDefense);
}

// ユニット群の大まかな戦力スコア(戦車は歩兵の2倍換算、HP割合で重み付け)
function computePowerScore(units) {
  return units.reduce((sum, u) => {
    const weight = u.type === "tank" ? 2 : 1;
    return sum + weight * (u.hp / UNIT_TYPES[u.type].hp);
  }, 0);
}

// point に最も近いユニットとの距離(ユニットがいなければ Infinity)
function nearestDistance(units, point) {
  if (units.length === 0) return Infinity;
  return Math.min(...units.map((u) => manhattan(u, point)));
}

// ターン開始時の状況分析。以降の全ユニット・生産判断で使い回す
function analyzeSituation(state, faction) {
  const enemyFaction = opponentOf(faction);
  const ownUnits = state.units.filter((u) => u.faction === faction && u.hp > 0);
  const enemyUnits = state.units.filter((u) => u.faction === enemyFaction && u.hp > 0);
  const enemyCapital = state.capitalLocation[enemyFaction];
  const ownCapital = state.capitalLocation[faction];

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
    ownCapital,
    money: state.money[faction],
    enemyMoney: state.money[enemyFaction],
    ownStats: factionStats(state, faction),
    enemyStats: factionStats(state, enemyFaction),
    enemyTankCount: enemyUnits.filter((u) => u.type === "tank").length,
    enemySoldierCount: enemyUnits.filter((u) => u.type === "soldier").length,
    ownTankCount: ownUnits.filter((u) => u.type === "tank").length,
    ownSoldierCount: ownUnits.filter((u) => u.type === "soldier").length,
  };
}

// 戦況分析の結果から今ターンの作戦モードを決定する(EXPAND / ATTACK / DEFEND / RECOVER)
function decideStrategy(situation) {
  const reasons = [];
  const ownPower = computePowerScore(situation.ownUnits);
  const enemyPower = computePowerScore(situation.enemyUnits);
  const powerRatio = ownPower / Math.max(enemyPower, 0.01);

  const nearestEnemyToOwnCapital = nearestDistance(situation.enemyUnits, situation.ownCapital);
  const nearestOwnToEnemyCapital = nearestDistance(situation.ownUnits, situation.enemyCapital);
  const capitalThreatened = nearestEnemyToOwnCapital <= STRATEGY_THRESHOLDS.CAPITAL_THREAT_DISTANCE;

  const ownTerritory = situation.ownStats.cities + situation.ownStats.factories;
  const enemyTerritory = situation.enemyStats.cities + situation.enemyStats.factories;
  const territoryRemaining = situation.captureTargets.length;

  let mode;
  if (capitalThreatened) {
    mode = "DEFEND";
    reasons.push(`own capital threatened (enemy unit ${nearestEnemyToOwnCapital} tiles away)`);
  } else if (powerRatio <= STRATEGY_THRESHOLDS.WEAK_POWER_RATIO) {
    mode = "RECOVER";
    reasons.push(`force disadvantage (power ratio ${powerRatio.toFixed(2)})`);
    if (situation.money < situation.enemyMoney) reasons.push(`money disadvantage (${situation.money}G vs ${situation.enemyMoney}G)`);
  } else if (powerRatio >= STRATEGY_THRESHOLDS.STRONG_POWER_RATIO) {
    mode = "ATTACK";
    reasons.push(`own force advantage (power ratio ${powerRatio.toFixed(2)})`);
    if (nearestOwnToEnemyCapital <= 5) reasons.push(`enemy capital exposed (${nearestOwnToEnemyCapital} tiles from our forces)`);
  } else if (territoryRemaining >= STRATEGY_THRESHOLDS.EXPAND_TERRITORY_MIN || ownTerritory < enemyTerritory) {
    mode = "EXPAND";
    reasons.push(`${territoryRemaining} capturable tiles still unclaimed`);
    if (ownTerritory < enemyTerritory) reasons.push(`behind in territory (own ${ownTerritory} vs enemy ${enemyTerritory})`);
  } else {
    mode = "ATTACK";
    reasons.push("forces roughly balanced and little territory left, pressing the advantage");
  }

  return { mode, reasons, ownPower, enemyPower, powerRatio, capitalThreatened };
}

// ユニット群の重心座標(グループの目標選定・支援判定に使う)
function centroidOf(units) {
  const row = Math.round(units.reduce((sum, u) => sum + u.row, 0) / units.length);
  const col = Math.round(units.reduce((sum, u) => sum + u.col, 0) / units.length);
  return { row, col };
}

// 攻撃グループの目標: 敵首都 or 敵の生産拠点(工場)のうち、戦車部隊の重心から最も近いもの
function pickAttackTarget(state, situation, members) {
  const centroid = centroidOf(members);
  const candidates = situation.captureTargets.filter(
    (t) => t.isEnemyCapital || TERRAIN[state.map[t.row][t.col]].producible
  );
  if (candidates.length === 0) {
    return { row: situation.enemyCapital.row, col: situation.enemyCapital.col, label: "敵首都" };
  }
  candidates.sort((a, b) => manhattan(centroid, a) - manhattan(centroid, b));
  const best = candidates[0];
  return { row: best.row, col: best.col, label: best.isEnemyCapital ? "敵首都" : "敵工場" };
}

// 占領グループの目標: 敵首都を除く未占領の占領可能地形のうち、歩兵部隊の重心から最も近いもの
function pickExpandTarget(situation, members) {
  const centroid = centroidOf(members);
  const candidates = situation.captureTargets.filter((t) => !t.isEnemyCapital);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => manhattan(centroid, a) - manhattan(centroid, b));
  const best = candidates[0];
  return { row: best.row, col: best.col, label: "未占領都市" };
}

// ターン開始時に、現在の作戦モードに応じて仮想的な「作戦グループ」を生成する。
// 正式な部隊クラスは持たず、対象ユニットの一覧と共通目標を持つだけの軽量な構造。
// グループに属さないユニットは従来通り個別に判断される(group bonus は 0 のまま)。
function formGroups(state, situation) {
  const mode = situation.strategy.mode;
  const groups = [];

  if (mode === "ATTACK") {
    const tanks = situation.ownUnits.filter((u) => u.type === "tank");
    if (tanks.length > 0) {
      groups.push({
        id: "attack-1",
        purpose: "attack",
        label: "攻撃グループ",
        members: tanks,
        target: pickAttackTarget(state, situation, tanks),
      });
    }
  } else if (mode === "EXPAND") {
    const soldiers = situation.ownUnits.filter((u) => u.type === "soldier");
    const target = soldiers.length > 0 ? pickExpandTarget(situation, soldiers) : null;
    if (target) {
      groups.push({
        id: "expand-1",
        purpose: "expand",
        label: "占領グループ",
        members: soldiers,
        target,
      });
    }
  } else if (mode === "DEFEND" || mode === "RECOVER") {
    const nearCapital = situation.ownUnits.filter(
      (u) => manhattan(u, situation.ownCapital) <= DEFEND_GROUP_RADIUS
    );
    if (nearCapital.length > 0) {
      groups.push({
        id: "defend-1",
        purpose: "defend",
        label: mode === "RECOVER" ? "再建グループ" : "防衛グループ",
        members: nearCapital,
        target: { row: situation.ownCapital.row, col: situation.ownCapital.col, label: "自軍首都" },
      });
    }
  }

  return groups;
}

// unitId → 所属グループ の参照テーブルを構築する(1ターン分)
function buildUnitGroupMap(groups) {
  const map = new Map();
  for (const g of groups) {
    for (const u of g.members) map.set(u.id, g);
  }
  return map;
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

// 前進候補: 攻撃・占領ができない場合に、役割(と作戦モード)に応じた戦略目標へ近づく行動
// 歩兵は未占領の占領可能地形を、戦車は敵主力(歩兵のみの相手を優先)や敵首都を目標にする。
// DEFEND時は自軍首都も候補目標に加える(retreatの受け皿)。
function generateAdvanceCandidate(state, unit, reachable, ctx) {
  const targets = [];

  if (unit.type === "soldier") {
    for (const t of ctx.captureTargets) {
      targets.push({
        row: t.row,
        col: t.col,
        weight: t.isEnemyCapital ? SCORE.APPROACH_ENEMY_CAPITAL : SCORE.APPROACH_TARGET_STEP,
        kind: t.isEnemyCapital ? "enemyCapital" : "captureTarget",
      });
    }
  } else {
    for (const enemy of ctx.enemyUnits) {
      const weight =
        enemy.type === "soldier" ? SCORE.APPROACH_TARGET_STEP + SCORE.SOFT_TARGET_BONUS / 4 : SCORE.APPROACH_TARGET_STEP;
      targets.push({ row: enemy.row, col: enemy.col, weight, kind: "enemyUnit" });
    }
    targets.push({ row: ctx.enemyCapital.row, col: ctx.enemyCapital.col, weight: SCORE.APPROACH_ENEMY_CAPITAL, kind: "enemyCapital" });
  }

  if (ctx.strategy.mode === "DEFEND") {
    targets.push({ row: ctx.ownCapital.row, col: ctx.ownCapital.col, weight: SCORE.APPROACH_ENEMY_CAPITAL, kind: "ownCapital" });
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
    targetKind: target.kind,
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
    kind: "defend",
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

// 候補生成の構造は変えず、生成し終えた候補一覧に作戦目標への貢献度だけを一括加点する
function computeStrategyBonus(candidate, mode) {
  switch (mode) {
    case "EXPAND":
      if (candidate.kind === "capture") return STRATEGY_BONUS;
      if (candidate.kind === "move" && candidate.targetKind === "captureTarget") return Math.round(STRATEGY_BONUS / 2);
      return 0;
    case "ATTACK":
      if (candidate.kind === "attack") return STRATEGY_BONUS;
      if (candidate.kind === "move" && candidate.targetKind === "enemyCapital") return STRATEGY_BONUS;
      return 0;
    case "DEFEND":
      if (candidate.kind === "defend") return STRATEGY_BONUS;
      if (candidate.kind === "move" && candidate.targetKind === "ownCapital") return STRATEGY_BONUS;
      if (candidate.kind === "attack" || candidate.kind === "capture") return STRATEGY_PENALTY;
      return 0;
    case "RECOVER":
      if (candidate.kind === "defend") return Math.round(STRATEGY_BONUS / 2);
      if (candidate.kind === "attack") return STRATEGY_PENALTY;
      return 0;
    default:
      return 0;
  }
}

function applyStrategyBonus(candidates, mode) {
  for (const c of candidates) {
    c.baseScore = c.score;
    c.strategyBonus = computeStrategyBonus(c, mode);
    c.score = c.baseScore + c.strategyBonus;
  }
}

// 候補1件分の連携度を評価する。所属グループの目標へ近づくか、移動後に味方の支援圏内にいるかを見る。
function computeGroupBonus(unit, candidate, group, situation) {
  let bonus = 0;
  const notes = [];
  const dest = { row: candidate.entry.row, col: candidate.entry.col };

  if (group && group.target) {
    const beforeDist = manhattan(unit, group.target);
    const afterDist = manhattan(dest, group.target);
    if (afterDist < beforeDist) {
      bonus += GROUP_SCORE.SAME_TARGET;
      notes.push("同じ目標へ前進");
    }
  }

  const alliesNearNow = situation.ownUnits.filter((u) => u.id !== unit.id && manhattan(u, unit) <= SUPPORT_RANGE).length;
  const alliesNearDest = situation.ownUnits.filter((u) => u.id !== unit.id && manhattan(u, dest) <= SUPPORT_RANGE).length;

  if (alliesNearDest > alliesNearNow) {
    bonus += GROUP_SCORE.CLOSER_TO_ALLIES;
    notes.push("味方との距離が近づく");
  }

  if (alliesNearDest === 0) {
    bonus += GROUP_SCORE.ISOLATED;
    notes.push("孤立する行動");
    if (candidate.kind === "attack") {
      bonus += GROUP_SCORE.SOLO_ASSAULT;
      notes.push("単独で敵主力へ突撃");
    }
  } else {
    bonus += GROUP_SCORE.SUPPORTED;
    notes.push("支援可能な味方がいる");
  }

  return { bonus, notes };
}

function applyGroupBonus(candidates, unit, group, situation) {
  for (const c of candidates) {
    const { bonus, notes } = computeGroupBonus(unit, c, group, situation);
    c.groupBonus = bonus;
    c.groupNotes = notes;
    c.score += bonus;
  }
}

// ユニット1体分の行動を評価値方式で決定する
// (候補を全て生成→作戦補正→グループ連携補正→最高評価を採用)
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

  applyStrategyBonus(candidates, situation.strategy.mode);

  const group = situation.unitGroupMap.get(unit.id) || null;
  applyGroupBonus(candidates, unit, group, situation);

  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates[0];
  logDecision(unit, chosen, group);
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

// 工場・首都での生産を状況(資金・敵戦力・作戦モード)に応じて決定する
function decideAndRunProduction(state, situation) {
  const faction = situation.faction;
  const mode = situation.strategy.mode;
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
    // 序盤 or EXPAND/RECOVER中は、対抗の必要がなければ低コストな歩兵で数を揃える
    const preferInfantry = (isEarlyGame || mode === "EXPAND" || mode === "RECOVER") && !needsTankCounter;

    let type;
    let reason;
    if (preferInfantry && canAffordSoldier) {
      type = "soldier";
      reason =
        mode === "RECOVER" ? "戦力再建のため低コストな歩兵を優先" : mode === "EXPAND" ? "領土拡大のため歩兵を優先" : "序盤は歩兵で領土拡大を優先";
    } else if (canAffordTank && (needsTankCounter || !preferInfantry)) {
      type = "tank";
      reason = needsTankCounter ? "敵戦車に対抗" : mode === "ATTACK" ? "攻勢のため戦車を増強" : "戦力強化";
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

// AI司令部: ターン開始時に状況分析→作戦モード決定を行い、各ユニットの役割と評価値
// (+作戦目標への貢献度)に基づいて行動する
function createAIController(state, faction) {
  const situation = analyzeSituation(state, faction);
  situation.strategy = decideStrategy(situation);
  situation.groups = formGroups(state, situation);
  situation.unitGroupMap = buildUnitGroupMap(situation.groups);

  async function takeTurn(animateMove) {
    if (AI_DEBUG) {
      console.debug(
        `[AI] === ターン${state.turn} ${faction}軍 状況分析 === 所持金${situation.money}G 自軍${situation.ownUnits.length}体 敵軍${situation.enemyUnits.length}体`
      );
      logStrategy(situation.strategy);
      logGroups(situation.groups);
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
