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
  CAPITAL_THREAT_SCORE: 100, // Threat Map上の自軍首都マスの脅威値がこれを超えたらDEFEND
  WEAK_POWER_RATIO: 0.65, // 戦力比がこれ未満なら劣勢
  STRONG_POWER_RATIO: 1.4, // 戦力比がこれ以上なら優勢
  EXPAND_TERRITORY_MIN: 2, // 未占領地(中立/敵地)がこの数以上残っていれば拡大余地ありとみなす
};

// Threat Map(戦場の危険度マップ)生成用の評価値
const THREAT_SCORE = {
  TANK_AT: 50, // 敵戦車の現在位置
  TANK_NEAR_1: 30, // 敵戦車から1マス以内
  TANK_NEAR_2: 15, // 敵戦車から2マス以内
  SOLDIER_AT: 20, // 敵兵士の現在位置
  SOLDIER_NEAR_1: 10, // 敵兵士から1マス以内
  VALUABLE_APPROACH: 25, // 都市/工場/首都に敵ユニットが接近している場合の追加加算
  VALUABLE_APPROACH_RANGE: 2,
  CAPITAL_NEAR_1: 100, // 自軍首都への最短距離1マス以内
  CAPITAL_NEAR_3: 50, // 同2〜3マス
  CAPITAL_NEAR_5: 20, // 同4〜5マス
};

// Threat Mapを個別行動評価に反映する際の加減点
const THREAT_BONUS = {
  DEFEND_APPROACH_HIGH_THREAT: 40, // 防衛グループ: より脅威の高い地点へ接近
  DEFEND_LEAVE_KEY_POINT: -30, // 防衛グループ: 防衛対象(重要拠点)から離れる
  ATTACK_INTO_THREAT: 20, // 攻撃グループ: 敵の脅威圏内へ進出(無謀な突撃でない場合のみ)
};

// Guard System: Threat Mapへの反応(defendグループ)とは別に、重要拠点には
// 平時から最低限の守備兵力を維持する。Threat Map/評価値方式を置き換えるのでは
// なく、その上位の判断材料として作戦グループ編成(guardグループ)に加える。
const GUARD_BASE = {
  CAPITAL: 2,
  FACTORY: 1,
  CITY: 0,
};
const GUARD_THREAT_LEVEL = {
  CAUTION: 20, // この値以上で「注意」
  DANGER: 60, // この値以上で「危険」(必要守備力+1)
};

// Combat Exchange Evaluation: ユニット種類ごとの戦力価値(コストと同期させる)
const UNIT_VALUE = {
  soldier: UNIT_TYPES.soldier.cost,
  tank: UNIT_TYPES.tank.cost,
};

// 価値差(コスト単位)をcombat bonusへ変換する際の縮小率(他の加減点とスケールを揃える)
const COMBAT_VALUE_SCALE = 3;

// 攻撃後の盤面価値(生存した場合のみ評価)に対する加減点
const COMBAT_POSITION_BONUS = {
  DEFENSIVE_TERRAIN: 10, // 防御地形に残る
  SUPPORTED: 15, // 味方支援範囲内に残る
  MISSION_APPROACH: 10, // 作戦目標へ近づく
  THREAT_EXPOSURE: -20, // 高Threat地点に孤立する
  THREAT_REMOVED: 20, // 自軍首都付近の脅威源を除去し、防衛線形成に寄与する
};
const COMBAT_THREAT_EXPOSURE_THRESHOLD = 50; // この値を超えるThreat Mapマスへの残留は危険とみなす

// 作戦目標への貢献度(候補生成の構造は変えず、生成後に一律で加減点する)
const STRATEGY_BONUS = 50;
const STRATEGY_PENALTY = -30;

// 複数ユニット連携(作戦グループ)関連の設定
const SUPPORT_RANGE = 2; // この距離以内に生存中の味方がいれば「支援可能」とみなす
const DEFEND_GROUP_RADIUS = 4; // 自軍首都(または脅威)からこの距離以内のユニットをグループに含める

// 全ユニット共通の孤立/連携チェック(グループの目的を問わない基礎点)
const GROUP_SCORE = {
  CLOSER_TO_ALLIES: 20, // 移動後、味方との距離が今より近くなる
  ISOLATED: -30, // 移動後、周囲に生存中の味方が誰もいない
  SUPPORTED: 20, // 移動後、周囲に生存中の味方が1体以上いる
  SOLO_ASSAULT: -50, // 孤立した状態での攻撃(単独突撃)への追加減点
};

// グループの目的(purpose)別の加減点。intercept は attack の基準を流用する。
const GROUP_PURPOSE_SCORE = {
  attack: {
    APPROACH_TARGET: 40, // 設定された敵目標(敵主力/敵工場/敵首都)へ接近
    MAINTAIN_ALLY_DISTANCE: 20, // 同じ攻撃グループの味方と近い距離を保つ
  },
  capture: {
    APPROACH_TARGET: 40, // 目標都市への接近
    FAST_CAPTURE: 30, // その場で占領が成立する(占領までのターン数を短縮)
    UNNECESSARY_COMBAT: -20, // 占領グループが本来不要な戦闘を選ぶ
  },
  defend: {
    APPROACH_TARGET: 40, // 防衛対象(首都など)への接近
    DEFENSIVE_TERRAIN: 30, // 防御力の高い地形に配置される
    LEAVE_TARGET: -40, // 防衛対象から離れる
  },
};

// 作戦(作戦グループの目標)をターンをまたいで維持する価値
const MISSION_BONUS = 30; // 同じ作戦目標へ近づく
const MISSION_PENALTY = -30; // 現在の作戦目標から遠ざかる
const MISSION_CRITICAL_BONUS = 50; // 作戦目標そのものへの占領/攻撃など、達成に直結する行動

const ADJACENT_OFFSETS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

// 自軍首都・自軍保有の都市/工場(=関心地点)の現在の脅威値を一覧表示する
function logThreatMap(state, situation) {
  if (!AI_DEBUG) return;
  const threatMap = situation.threatMap;
  const points = [{ row: situation.ownCapital.row, col: situation.ownCapital.col, label: TERRAIN.CAPITAL.label }];
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (r === situation.ownCapital.row && c === situation.ownCapital.col) continue;
      const terrain = TERRAIN[state.map[r][c]];
      if (terrain.capturable && state.ownership[r][c] === situation.faction) {
        points.push({ row: r, col: c, label: terrain.label });
      }
    }
  }
  points.sort((a, b) => threatMap[b.row][b.col] - threatMap[a.row][a.col]);
  const lines = points.map((p) => `${p.label}(${p.row},${p.col}): ${threatMap[p.row][p.col]}`);
  console.debug(`[AI Threat Map]\n${lines.join("\n")}`);
}

// 防衛グループの目標選定(新規形成・変更時)の理由をログ出力する
function logDefense(situation, target) {
  if (!AI_DEBUG) return;
  console.debug(
    `[AI Defense]\n` +
      `Target:\n${target.label}(${target.row},${target.col})\n` +
      `Threat:\n${target.threatScore}\n` +
      `Reason:\n${describeThreatReason(situation, target)}`
  );
}

// 守備隊(guardグループ)の新規編成/増援/解除を [AI Guard] としてログ出力する
function logGuard({ target, required, current, assignedIds = [], releasedIds = [], reason }) {
  if (!AI_DEBUG) return;
  console.debug(
    `[AI Guard]\n` +
      `Guard Target:\n${target.label}(${target.row},${target.col})\n` +
      `Required Defense:\n${required}\n` +
      `Current Defense:\n${current}\n` +
      `Assigned Units:\n${assignedIds.length ? assignedIds.join(", ") : "-"}\n` +
      `Released Units:\n${releasedIds.length ? releasedIds.join(", ") : "-"}\n` +
      `Reason:\n${reason}`
  );
}

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
  const missionNoteText =
    candidate.missionNotes && candidate.missionNotes.length ? ` (${candidate.missionNotes.join(", ")})` : "";
  const threatNoteText =
    candidate.threatNotes && candidate.threatNotes.length ? ` (${candidate.threatNotes.join(", ")})` : "";
  const combatNoteText =
    candidate.combatNotes && candidate.combatNotes.length ? ` (${candidate.combatNotes.join(", ")})` : "";
  console.debug(
    `[AI Decision] ${tag}:\n` +
      `${candidate.label}${candidate.detail ? ` (${candidate.detail})` : ""}\n` +
      `base score: ${candidate.baseScore}\n` +
      `strategy bonus: ${candidate.strategyBonus}\n` +
      `group bonus: ${candidate.groupBonus}${groupNoteText}\n` +
      `mission bonus: ${candidate.missionBonus}${missionNoteText}\n` +
      `threat bonus: ${candidate.threatBonus}${threatNoteText}\n` +
      `combat bonus: ${candidate.combatBonus}${combatNoteText}\n` +
      `total: ${candidate.score}`
  );
}

function logGroups(groups) {
  if (!AI_DEBUG || groups.length === 0) return;
  const blocks = groups.map((g, i) => {
    const memberLines = g.members.map((u) => `- ${UNIT_TYPES[u.type].label}#${u.id}`).join("\n");
    return (
      `Group ${i + 1}: ${g.label} (ID:${g.id}, ターン${g.createdTurn}〜)\n` +
      `type: ${g.purpose.toUpperCase()}\n` +
      `target: ${g.target.label}(${g.target.row},${g.target.col})\n` +
      `members:\n${memberLines}`
    );
  });
  console.debug(`[AI Groups]\n\n${blocks.join("\n\n")}`);
}

// 永続グループの継続/変更/破棄/新規/増援を [AI Mission] としてログ出力する
function logMissionReviews(missionLogs) {
  if (!AI_DEBUG || missionLogs.length === 0) return;
  for (const entry of missionLogs) {
    if (entry.status === "CHANGED") {
      console.debug(
        `[AI Mission]\n` +
          `Group ID: ${entry.group.id}\n` +
          `Status: CHANGED\n` +
          `Old target:\n${entry.oldTarget.label}(${entry.oldTarget.row},${entry.oldTarget.col})\n` +
          `New target:\n${entry.newTarget.label}(${entry.newTarget.row},${entry.newTarget.col})\n` +
          `Reason:\n${entry.reasons.join(", ")}`
      );
    } else {
      console.debug(
        `[AI Mission]\n` +
          `Group ID: ${entry.group.id}\n` +
          `Type: ${entry.group.purpose.toUpperCase()}\n` +
          `Target: ${entry.group.target.label}(${entry.group.target.row},${entry.group.target.col})\n` +
          `Status: ${entry.status}\n` +
          `Reason:\n${entry.reasons.map((r) => `- ${r}`).join("\n")}`
      );
    }
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

// Threat Map: マップ上の各マスが敵からどれだけ危険かをルールベースで数値化する。
// ターン開始時に状況分析より先に生成し、以降の戦略/作戦/戦術の全レイヤーから参照する。
// state から直接読むため、situation オブジェクトには依存しない。
function buildThreatMap(state, faction) {
  const enemyFaction = opponentOf(faction);
  const enemyUnits = state.units.filter((u) => u.faction === enemyFaction && u.hp > 0);
  const ownCapital = state.capitalLocation[faction];

  const map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(0));

  for (const enemy of enemyUnits) {
    const rings =
      enemy.type === "tank"
        ? [
            [0, THREAT_SCORE.TANK_AT],
            [1, THREAT_SCORE.TANK_NEAR_1],
            [2, THREAT_SCORE.TANK_NEAR_2],
          ]
        : [
            [0, THREAT_SCORE.SOLDIER_AT],
            [1, THREAT_SCORE.SOLDIER_NEAR_1],
          ];
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        const dist = Math.abs(r - enemy.row) + Math.abs(c - enemy.col);
        for (const [ringDist, value] of rings) {
          if (dist === ringDist) {
            map[r][c] += value;
            break;
          }
        }
      }
    }
  }

  // 占領価値のある地点(都市/工場/首都)へ敵ユニットが接近している場合は追加加算
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const terrain = TERRAIN[state.map[r][c]];
      if (!terrain.capturable) continue;
      const approached = enemyUnits.some(
        (u) => Math.abs(u.row - r) + Math.abs(u.col - c) <= THREAT_SCORE.VALUABLE_APPROACH_RANGE
      );
      if (approached) map[r][c] += THREAT_SCORE.VALUABLE_APPROACH;
    }
  }

  // 自軍首都への近さによる追加脅威(首都防衛の緊急度)
  const nearestToCapital = nearestDistance(enemyUnits, ownCapital);
  let capitalBonus = 0;
  if (nearestToCapital <= 1) capitalBonus = THREAT_SCORE.CAPITAL_NEAR_1;
  else if (nearestToCapital <= 3) capitalBonus = THREAT_SCORE.CAPITAL_NEAR_3;
  else if (nearestToCapital <= 5) capitalBonus = THREAT_SCORE.CAPITAL_NEAR_5;
  if (capitalBonus > 0) map[ownCapital.row][ownCapital.col] += capitalBonus;

  return map;
}

// target 地点にとって最も近い敵ユニットから、脅威の理由を短く説明する
function describeThreatReason(situation, target) {
  if (situation.enemyUnits.length === 0) return "no immediate threat detected";
  const nearest = [...situation.enemyUnits].sort((a, b) => manhattan(a, target) - manhattan(b, target))[0];
  const dist = manhattan(nearest, target);
  const label = nearest.type === "tank" ? "Enemy Tank" : "Enemy Soldier";
  return dist <= 1 ? `${label} approaching` : `${label} nearby (${dist} tiles away)`;
}

// 作戦グループをターンをまたいで保持するための永続領域。state 自体はゲーム開始/リスタートの
// たびに createInitialState() で新規作成されるため、_aiMemory も自然にリセットされる。
// state.js / main.js には一切手を入れず、ai.js だけで完結させる。
function getAiMemory(state, faction) {
  if (!state._aiMemory) state._aiMemory = {};
  if (!state._aiMemory[faction]) state._aiMemory[faction] = { groups: [], nextGroupId: 1 };
  return state._aiMemory[faction];
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
  const capitalThreatScore = situation.threatMap[situation.ownCapital.row][situation.ownCapital.col];
  const capitalThreatened = capitalThreatScore > STRATEGY_THRESHOLDS.CAPITAL_THREAT_SCORE;

  const ownTerritory = situation.ownStats.cities + situation.ownStats.factories;
  const enemyTerritory = situation.enemyStats.cities + situation.enemyStats.factories;
  const territoryRemaining = situation.captureTargets.length;

  let mode;
  if (capitalThreatened) {
    mode = "DEFEND";
    reasons.push(
      `capital threat score ${capitalThreatScore} exceeds ${STRATEGY_THRESHOLDS.CAPITAL_THREAT_SCORE} (nearest enemy ${nearestEnemyToOwnCapital} tiles away)`
    );
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

// 攻撃グループの目標: 敵首都 or 敵の生産拠点(工場)のうち、戦車部隊の重心からの距離と
// Threat Map上の脅威値(=敵の防衛戦力の目安、値が低いほど手薄)を合わせて評価する。
function pickAttackTarget(state, situation, members) {
  const threatMap = situation.threatMap;
  const centroid = centroidOf(members);
  const candidates = situation.captureTargets.filter(
    (t) => t.isEnemyCapital || TERRAIN[state.map[t.row][t.col]].producible
  );
  if (candidates.length === 0) {
    const row = situation.enemyCapital.row;
    const col = situation.enemyCapital.col;
    return { row, col, label: "敵首都", threatScore: threatMap[row][col] };
  }
  candidates.sort((a, b) => {
    const scoreA = manhattan(centroid, a) + threatMap[a.row][a.col] / 10;
    const scoreB = manhattan(centroid, b) + threatMap[b.row][b.col] / 10;
    return scoreA - scoreB;
  });
  const best = candidates[0];
  return {
    row: best.row,
    col: best.col,
    label: best.isEnemyCapital ? "敵首都" : "敵工場",
    threatScore: threatMap[best.row][best.col],
  };
}

// 占領グループの目標: 敵首都を除く未占領の占領可能地形のうち、歩兵部隊の重心から最も近いもの
function pickCaptureTarget(situation, members) {
  const centroid = centroidOf(members);
  const candidates = situation.captureTargets.filter((t) => !t.isEnemyCapital);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => manhattan(centroid, a) - manhattan(centroid, b));
  const best = candidates[0];
  return { row: best.row, col: best.col, label: "未占領都市" };
}

// 迎撃グループの目標: 自軍へ迫っている敵ユニットのうち、迎撃部隊の重心から最も近いもの
function pickInterceptTarget(situation, members) {
  if (situation.enemyUnits.length === 0) return null;
  const centroid = centroidOf(members);
  const sorted = [...situation.enemyUnits].sort((a, b) => manhattan(centroid, a) - manhattan(centroid, b));
  return { row: sorted[0].row, col: sorted[0].col, label: "侵攻部隊" };
}

function capitalTarget(situation) {
  return { row: situation.ownCapital.row, col: situation.ownCapital.col, label: "自軍首都" };
}

// 防衛グループの目標: 自軍首都および自軍が保有する都市/工場のうち、Threat Map上で
// 最も脅威値が高い地点を優先する(僅差の場合のみ部隊重心からの距離でタイブレーク)。
function pickDefendTarget(state, situation, members) {
  const threatMap = situation.threatMap;
  const candidates = [capitalTarget(situation)];
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (r === situation.ownCapital.row && c === situation.ownCapital.col) continue;
      const terrain = TERRAIN[state.map[r][c]];
      if (terrain.capturable && state.ownership[r][c] === situation.faction) {
        candidates.push({ row: r, col: c, label: terrain.label });
      }
    }
  }

  const centroid = centroidOf(members);
  candidates.sort((a, b) => {
    const diff = threatMap[b.row][b.col] - threatMap[a.row][a.col];
    if (diff !== 0) return diff;
    return manhattan(centroid, a) - manhattan(centroid, b);
  });

  const best = candidates[0];
  return { row: best.row, col: best.col, label: best.label, threatScore: threatMap[best.row][best.col] };
}

// Guard System: 拠点ごとにThreat Mapを踏まえた必要守備力(0以上の整数)を算出する。
// 数値はGUARD_BASE/GUARD_THREAT_LEVELとして定数化済み。首都は必ず基礎守備力を持ち、
// 工場・都市はThreat Mapの危険度に応じて必要守備力が上がる(都市は平時0、危険化で1)。
function guardThreatLevel(threatScore) {
  if (threatScore >= GUARD_THREAT_LEVEL.DANGER) return "danger";
  if (threatScore >= GUARD_THREAT_LEVEL.CAUTION) return "caution";
  return "safe";
}

function guardPointFor(situation, row, col, label, base) {
  const threatScore = situation.threatMap[row][col];
  const level = guardThreatLevel(threatScore);
  let required = base;
  if (level === "danger") required = base + 1;
  else if (level === "caution" && base === 0) required = 1;
  return { row, col, label, threatScore, level, required };
}

function computeGuardRequirements(state, situation) {
  const cap = situation.ownCapital;
  const points = [guardPointFor(situation, cap.row, cap.col, TERRAIN.CAPITAL.label, GUARD_BASE.CAPITAL)];
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (r === cap.row && c === cap.col) continue;
      const terrain = TERRAIN[state.map[r][c]];
      if (!terrain.capturable || state.ownership[r][c] !== situation.faction) continue;
      const base = terrain.id === "FACTORY" ? GUARD_BASE.FACTORY : GUARD_BASE.CITY;
      points.push(guardPointFor(situation, r, c, terrain.label, base));
    }
  }
  return points;
}

// unit が自軍首都/脅威からの防衛・迎撃を担うのに十分近いか
function isNearCapital(situation, unit) {
  return manhattan(unit, situation.ownCapital) <= DEFEND_GROUP_RADIUS;
}
function isNearThreat(situation, unit) {
  return nearestDistance(situation.enemyUnits, unit) <= DEFEND_GROUP_RADIUS;
}

// グループの目標をすでに達成したか(=目標地形を自軍が占領済みか、迎撃対象が消えたか)
function isGroupTargetAchieved(state, situation, group) {
  if (group.purpose === "attack" || group.purpose === "capture") {
    if (ownerAt(state, group.target.row, group.target.col) === situation.faction) return true;
  }
  if (group.purpose === "intercept") {
    const stillThere = situation.enemyUnits.some((u) => u.row === group.target.row && u.col === group.target.col);
    if (!stillThere) return true;
  }
  return false;
}

// 目標付近の敵戦力に対し、グループの残存戦力が著しく劣っていれば無理に攻略を続けさせない
function isGroupOverwhelmed(situation, group) {
  if (group.purpose !== "attack" && group.purpose !== "intercept") return false;
  const groupPower = computePowerScore(group.members);
  const nearbyEnemyPower = computePowerScore(
    situation.enemyUnits.filter((u) => manhattan(u, group.target) <= DEFEND_GROUP_RADIUS)
  );
  return nearbyEnemyPower > 0 && groupPower / nearbyEnemyPower < STRATEGY_THRESHOLDS.WEAK_POWER_RATIO;
}

// 現在の目標を維持すべきか、より重要/近い目標へ切り替えるべきかを判定する
function reevaluateTarget(state, situation, group) {
  let idealTarget = null;
  if (group.purpose === "attack") idealTarget = pickAttackTarget(state, situation, group.members);
  else if (group.purpose === "capture") idealTarget = pickCaptureTarget(situation, group.members);
  else if (group.purpose === "intercept") idealTarget = pickInterceptTarget(situation, group.members);
  else if (group.purpose === "defend") idealTarget = pickDefendTarget(state, situation, group.members);
  else return { changed: false, reasons: ["対象なし"] };

  if (!idealTarget) return { changed: false, reasons: ["代替目標なし、現状維持"] };
  if (idealTarget.row === group.target.row && idealTarget.col === group.target.col) {
    return { changed: false, reasons: ["部隊は順調に接近中", "敵の防衛状況は許容範囲"] };
  }

  if (group.purpose === "defend") {
    return {
      changed: true,
      target: idealTarget,
      reasons: [`脅威値が高い地点(${idealTarget.label})へ防衛対象を切り替え`],
    };
  }

  const centroid = centroidOf(group.members);
  const distToCurrent = manhattan(centroid, group.target);
  const distToIdeal = manhattan(centroid, idealTarget);
  const isCapitalOpportunity = idealTarget.label === "敵首都" && group.target.label !== "敵首都";

  if (isCapitalOpportunity || distToIdeal < distToCurrent) {
    return {
      changed: true,
      target: idealTarget,
      reasons: isCapitalOpportunity ? ["敵首都が無防備になった"] : ["より重要/近い目標が出現した"],
    };
  }
  return { changed: false, reasons: ["現在の目標を優先", "より有利な代替目標なし"] };
}

// まだどのグループにも属していないユニットを、既存の同目的グループへ増援として合流させるか、
// どの目的にも合致しなければ新規グループとして生成する(従来の formGroups 相当のロジック)。
function formMissingGroups(state, situation, memory, assignedIds, missionLogs) {
  const mode = situation.strategy.mode;

  function tryFormGroup(purpose, label, memberFilter, targetPicker) {
    const candidates = situation.ownUnits.filter((u) => !assignedIds.has(u.id) && memberFilter(u));
    if (candidates.length === 0) return;

    const existingGroup = memory.groups.find((g) => g.purpose === purpose);
    if (existingGroup) {
      for (const u of candidates) {
        existingGroup.memberIds.push(u.id);
        assignedIds.add(u.id);
      }
      existingGroup.members = [...existingGroup.members, ...candidates];
      missionLogs.push({ group: existingGroup, status: "REINFORCED", reasons: [`${candidates.length}体が増援として合流`] });
      return;
    }

    const target = targetPicker(candidates);
    if (!target) return;
    const group = {
      id: memory.nextGroupId++,
      purpose,
      label,
      memberIds: candidates.map((u) => u.id),
      members: candidates,
      target,
      status: "active",
      createdTurn: state.turn,
    };
    for (const u of candidates) assignedIds.add(u.id);
    memory.groups.push(group);
    missionLogs.push({ group, status: "NEW", reasons: ["新規作戦を開始"] });
    if (purpose === "defend") logDefense(situation, target);
  }

  if (mode === "ATTACK") {
    tryFormGroup("attack", "攻撃グループ", (u) => u.type === "tank", (members) => pickAttackTarget(state, situation, members));
    tryFormGroup("capture", "占領グループ", (u) => u.type === "soldier", (members) => pickCaptureTarget(situation, members));
    tryFormGroup("defend", "防衛グループ", (u) => isNearCapital(situation, u), (members) => pickDefendTarget(state, situation, members));
  } else if (mode === "EXPAND") {
    tryFormGroup("capture", "占領グループ", (u) => u.type === "soldier", (members) => pickCaptureTarget(situation, members));
    tryFormGroup("defend", "防衛グループ", (u) => isNearCapital(situation, u), (members) => pickDefendTarget(state, situation, members));
  } else if (mode === "DEFEND") {
    tryFormGroup("intercept", "迎撃グループ", (u) => isNearThreat(situation, u), (members) => pickInterceptTarget(situation, members));
    tryFormGroup("defend", "防衛グループ", (u) => isNearCapital(situation, u), (members) => pickDefendTarget(state, situation, members));
  } else if (mode === "RECOVER") {
    tryFormGroup("defend", "再建グループ", (u) => isNearCapital(situation, u), (members) => pickDefendTarget(state, situation, members));
  }
}

// Guard System: ターン開始時に毎回、既存の守備隊(purpose: "guard")を見直し
// (脅威が下がった/拠点が重要でなくなった等で不要になれば解除して通常の作戦
// グループへ戻す)、不足している拠点には新規編成・増援を行う。既存の戦略モード
// 決定・永続グループ・評価値方式の構造は変更せず、group bonus/threat bonus
// (既存のdefendテーブル/分岐を流用)へ自然に統合するため、新しい評価項目は
// 追加しない。formMissingGroups/reviewAndFormGroupsより前に実行することで、
// 攻撃/占領グループの形成前に最低限の守備兵力を優先確保し、既存グループを
// 極端に崩さないようにする。
function manageGuardGroups(state, situation, memory) {
  const requirements = computeGuardRequirements(state, situation);
  const reqByKey = new Map(requirements.map((p) => [tileKey(p.row, p.col), p]));

  // 1. 既存の守備隊を再評価。必要守備力が0になった拠点の守備隊は解除する。
  memory.groups = memory.groups.filter((group) => {
    if (group.purpose !== "guard") return true;

    const liveMembers = group.memberIds
      .map((id) => state.units.find((u) => u.id === id && u.hp > 0))
      .filter(Boolean);

    if (liveMembers.length === 0) {
      logGuard({ target: group.target, required: 0, current: 0, releasedIds: group.memberIds, reason: "部隊全滅により解除" });
      return false;
    }
    group.members = liveMembers;
    group.memberIds = liveMembers.map((u) => u.id);

    const req = reqByKey.get(tileKey(group.target.row, group.target.col));
    if (!req || req.required === 0) {
      logGuard({
        target: group.target,
        required: req ? req.required : 0,
        current: 0,
        releasedIds: group.memberIds,
        reason: "脅威低下/前線変化により防衛解除、通常の作戦グループへ復帰",
      });
      return false;
    }
    group.target = req; // 最新のThreat Map値・分類に更新
    return true;
  });

  // 2. 既存グループ(guard含む全種)に属するユニットIDを割当済みとして扱う
  const assignedIds = new Set(memory.groups.flatMap((g) => g.memberIds));

  // 3. 拠点ごとに不足分を補充する
  for (const req of requirements) {
    if (req.required === 0) continue;

    let group = memory.groups.find((g) => g.purpose === "guard" && tileKey(g.target.row, g.target.col) === tileKey(req.row, req.col));
    let shortage = req.required - (group ? group.members.length : 0);
    if (shortage <= 0) continue;

    const assignedNow = [];

    // 3a. 未割当ユニットから拠点に近い順に補充する(作戦を壊さない)
    const freeCandidates = situation.ownUnits
      .filter((u) => !assignedIds.has(u.id))
      .sort((a, b) => manhattan(a, req) - manhattan(b, req));
    for (const u of freeCandidates) {
      if (shortage <= 0) break;
      assignedNow.push(u);
      assignedIds.add(u.id);
      shortage -= 1;
    }

    // 3b. それでも不足し、かつ拠点が「危険」な場合のみ、複数人いる攻撃/占領
    //     グループから最小限(1体ずつ)引き抜く(攻撃グループを極端に崩さない)
    if (shortage > 0 && req.level === "danger") {
      const donors = memory.groups
        .filter((g) => (g.purpose === "attack" || g.purpose === "capture") && g.members.length > 1)
        .sort((a, b) => manhattan(centroidOf(a.members), req) - manhattan(centroidOf(b.members), req));
      for (const donor of donors) {
        if (shortage <= 0) break;
        const sorted = [...donor.members].sort((a, b) => manhattan(a, req) - manhattan(b, req));
        const pulled = sorted[0];
        donor.members = donor.members.filter((u) => u.id !== pulled.id);
        donor.memberIds = donor.members.map((u) => u.id);
        assignedNow.push(pulled);
        assignedIds.add(pulled.id);
        shortage -= 1;
      }
    }

    if (assignedNow.length === 0) continue;

    if (!group) {
      group = {
        id: memory.nextGroupId++,
        purpose: "guard",
        label: "守備隊",
        memberIds: [],
        members: [],
        target: req,
        status: "active",
        createdTurn: state.turn,
      };
      memory.groups.push(group);
    }
    group.members = [...group.members, ...assignedNow];
    group.memberIds = group.members.map((u) => u.id);

    logGuard({
      target: req,
      required: req.required,
      current: group.members.length,
      assignedIds: assignedNow.map((u) => u.id),
      reason: `脅威度${req.threatScore}(${req.level})のため守備力${req.required}が必要`,
    });
  }
}

// ターン開始時に、永続している作戦グループを継続/変更/破棄のいずれかに判定する。
// 生き残ったグループにまだ属していないユニットは formMissingGroups に引き継ぐ。
function reviewAndFormGroups(state, situation, memory) {
  const mode = situation.strategy.mode;
  const missionLogs = [];

  memory.groups = memory.groups.filter((group) => {
    if (group.purpose === "guard") return true; // Guard Systemが別途管理済み(manageGuardGroups)

    const liveMembers = group.memberIds
      .map((id) => state.units.find((u) => u.id === id && u.hp > 0))
      .filter(Boolean);

    if (liveMembers.length === 0) {
      missionLogs.push({ group, status: "DISCARDED", reasons: ["部隊全滅"] });
      return false;
    }
    group.members = liveMembers;
    group.memberIds = liveMembers.map((u) => u.id);

    if (isGroupTargetAchieved(state, situation, group)) {
      missionLogs.push({ group, status: "ACHIEVED", reasons: ["目標達成"] });
      return false;
    }

    if ((mode === "DEFEND" || mode === "RECOVER") && (group.purpose === "attack" || group.purpose === "capture")) {
      missionLogs.push({ group, status: "DISCARDED", reasons: [`作戦モード(${mode})への切り替えにより解散`] });
      return false;
    }

    if (isGroupOverwhelmed(situation, group)) {
      missionLogs.push({ group, status: "DISCARDED", reasons: ["目標付近の敵戦力が優勢のため攻略断念"] });
      return false;
    }

    const reevaluated = reevaluateTarget(state, situation, group);
    if (reevaluated.changed) {
      missionLogs.push({
        group,
        status: "CHANGED",
        oldTarget: group.target,
        newTarget: reevaluated.target,
        reasons: reevaluated.reasons,
      });
      group.target = reevaluated.target;
      if (group.purpose === "defend") logDefense(situation, reevaluated.target);
    } else {
      missionLogs.push({ group, status: "CONTINUE", reasons: reevaluated.reasons });
    }

    return true;
  });

  const assignedIds = new Set(memory.groups.flatMap((g) => g.memberIds));
  formMissingGroups(state, situation, memory, assignedIds, missionLogs);

  return missionLogs;
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

      let counterDamage = 0;
      let attackerDies = false;
      if (!isLethal) {
        counterDamage = computeDamage(target.type, terrainAt(state, entry.row, entry.col).defense);
        attackerDies = counterDamage >= unit.hp;
        if (attackerDies) {
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
        damage,
        isLethal,
        counterDamage,
        attackerDies,
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

// グループの目的(purpose)ごとに異なる加減点を行う。intercept は attack の基準を、
// guard(常駐守備隊)は defend の基準をそれぞれ流用する(新しい評価項目は追加しない)。
function computePurposeBonus(state, unit, candidate, group, dest) {
  const purpose = group.purpose === "intercept" ? "attack" : group.purpose === "guard" ? "defend" : group.purpose;
  const table = GROUP_PURPOSE_SCORE[purpose];
  if (!table) return { bonus: 0, notes: [] };

  let bonus = 0;
  const notes = [];
  const beforeDist = manhattan(unit, group.target);
  const afterDist = manhattan(dest, group.target);

  if (purpose === "attack") {
    if (afterDist < beforeDist) {
      bonus += table.APPROACH_TARGET;
      notes.push("設定された敵目標へ接近");
    }
    const nearGroupAllies = group.members.some((u) => u.id !== unit.id && manhattan(u, dest) <= SUPPORT_RANGE * 2);
    if (nearGroupAllies) {
      bonus += table.MAINTAIN_ALLY_DISTANCE;
      notes.push("同じ攻撃グループの味方と距離維持");
    }
  } else if (purpose === "capture") {
    if (afterDist < beforeDist) {
      bonus += table.APPROACH_TARGET;
      notes.push("目標都市へ接近");
    }
    if (candidate.kind === "capture") {
      bonus += table.FAST_CAPTURE;
      notes.push("占領可能ターン短縮");
    }
    if (candidate.kind === "attack") {
      bonus += table.UNNECESSARY_COMBAT;
      notes.push("不要な戦闘");
    }
  } else if (purpose === "defend") {
    if (afterDist < beforeDist) {
      bonus += table.APPROACH_TARGET;
      notes.push("防衛対象へ接近");
    } else if (afterDist > beforeDist) {
      bonus += table.LEAVE_TARGET;
      notes.push("防衛対象から離れる");
    }
    const terrain = terrainAt(state, dest.row, dest.col);
    if (terrain.defense > 0) {
      bonus += table.DEFENSIVE_TERRAIN;
      notes.push("防御地形へ配置");
    }
  }

  return { bonus, notes };
}

// 候補1件分の連携度を評価する。まず全ユニット共通の孤立/連携チェックを行い、
// 所属グループがあればその目的(attack/capture/defend)に応じた加減点を追加する。
function computeGroupBonus(state, unit, candidate, group, situation) {
  let bonus = 0;
  const notes = [];
  const dest = { row: candidate.entry.row, col: candidate.entry.col };

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

  if (group && group.target) {
    const purposeResult = computePurposeBonus(state, unit, candidate, group, dest);
    bonus += purposeResult.bonus;
    notes.push(...purposeResult.notes);
  }

  return { bonus, notes };
}

function applyGroupBonus(candidates, state, unit, group, situation) {
  for (const c of candidates) {
    const { bonus, notes } = computeGroupBonus(state, unit, c, group, situation);
    c.groupBonus = bonus;
    c.groupNotes = notes;
    c.score += bonus;
  }
}

// 「今進行中の作戦(グループの目標)を維持する価値」を評価する。
// 状況が悪化していれば(グループ自体が解散/変更されているはずなので)ここでは
// 単純に「同じ目標へ向かっているか」だけを見る。
function computeMissionBonus(unit, candidate, group) {
  if (!group || !group.target) return { bonus: 0, notes: [] };

  const dest = { row: candidate.entry.row, col: candidate.entry.col };
  const beforeDist = manhattan(unit, group.target);
  const afterDist = manhattan(dest, group.target);

  let bonus = 0;
  const notes = [];

  if (afterDist < beforeDist) {
    bonus += MISSION_BONUS;
    notes.push("同じ作戦目標へ接近");
  } else if (afterDist > beforeDist) {
    bonus += MISSION_PENALTY;
    notes.push("現在の作戦目標から外れる");
  }

  const isMissionCriticalAction =
    (candidate.kind === "capture" && dest.row === group.target.row && dest.col === group.target.col) ||
    (candidate.kind === "attack" &&
      candidate.target &&
      candidate.target.row === group.target.row &&
      candidate.target.col === group.target.col);
  if (isMissionCriticalAction) {
    bonus += MISSION_CRITICAL_BONUS;
    notes.push("作戦達成に必要な行動");
  }

  return { bonus, notes };
}

function applyMissionBonus(candidates, unit, group) {
  for (const c of candidates) {
    const { bonus, notes } = computeMissionBonus(unit, c, group);
    c.missionBonus = bonus;
    c.missionNotes = notes;
    c.score += bonus;
  }
}

// Threat Mapを踏まえた加減点。防衛グループは防衛対象(脅威地点)への接近/離脱を、
// 攻撃グループは敵の脅威圏内への進出を評価する。ただし進出先が致命的なリスクを
// 伴う場合(反撃で撃破される)は無謀な突撃とみなし、ボーナスを与えない。
function computeThreatBonus(state, unit, candidate, group, ctx) {
  if (!group || !group.target) return { bonus: 0, notes: [] };
  const threatMap = ctx.threatMap;
  const dest = { row: candidate.entry.row, col: candidate.entry.col };
  let bonus = 0;
  const notes = [];

  if (group.purpose === "defend" || group.purpose === "guard") {
    const beforeDist = manhattan(unit, group.target);
    const afterDist = manhattan(dest, group.target);
    const targetThreat = threatMap[group.target.row][group.target.col];
    if (targetThreat > 0 && afterDist < beforeDist) {
      bonus += THREAT_BONUS.DEFEND_APPROACH_HIGH_THREAT;
      notes.push("高脅威地点へ接近");
    } else if (afterDist > beforeDist) {
      bonus += THREAT_BONUS.DEFEND_LEAVE_KEY_POINT;
      notes.push("防衛対象(重要拠点)から離れる");
    }
  } else if (group.purpose === "attack" || group.purpose === "intercept") {
    const destThreat = threatMap[dest.row][dest.col];
    const currentThreat = threatMap[unit.row][unit.col];
    if (destThreat > currentThreat) {
      const risk = assessDestinationRisk(state, unit, dest.row, dest.col, ctx.enemyUnits);
      if (risk.penalty === SCORE.RISK_LOSS_PENALTY) {
        notes.push("無謀な突撃のため見送り");
      } else {
        bonus += THREAT_BONUS.ATTACK_INTO_THREAT;
        notes.push("敵の脅威圏内へ進出");
      }
    }
  }

  return { bonus, notes };
}

function applyThreatBonus(candidates, state, unit, group, ctx) {
  for (const c of candidates) {
    const { bonus, notes } = computeThreatBonus(state, unit, c, group, ctx);
    c.threatBonus = bonus;
    c.threatNotes = notes;
    c.score += bonus;
  }
}

function formatExchangeRatio(ratio) {
  if (ratio === Infinity) return "infinite";
  return Number.isInteger(ratio) ? String(ratio) : ratio.toFixed(2);
}

function logCombatEvaluation(unit, target, evaluation) {
  if (!AI_DEBUG) return;
  const reasonLine = evaluation.notes.length ? `\nReason:\n${evaluation.notes.join(", ")}` : "";
  console.debug(
    `[AI Combat Evaluation]\n` +
      `Unit:\n${UNIT_TYPES[unit.type].label}#${unit.id}\n` +
      `Target:\n${UNIT_TYPES[target.type].label}#${target.id}\n` +
      `Damage:\n${evaluation.damage}\n` +
      `Counter Damage:\n${evaluation.counterDamage}\n` +
      `Enemy Value:\n${evaluation.enemyValueLoss}\n` +
      `Own Risk:\n${evaluation.ownValueLoss}\n` +
      `Exchange Ratio:\n${formatExchangeRatio(evaluation.exchangeRatio)}\n` +
      `Combat Bonus:\n${evaluation.bonus >= 0 ? "+" : ""}${evaluation.bonus}` +
      reasonLine
  );
}

// 攻撃候補1件分の「戦力交換」としての価値を評価する。撃破数ではなく、
// 敵/自軍それぞれが失う戦力価値の差(=盤面全体の戦力バランスへの影響)を見る。
function computeCombatBonus(state, unit, candidate, situation, group) {
  const { target, damage, isLethal, counterDamage, attackerDies } = candidate;
  const dest = { row: candidate.entry.row, col: candidate.entry.col };

  const enemyValue = UNIT_VALUE[target.type];
  const ownValue = UNIT_VALUE[unit.type];
  const enemyValueLoss = isLethal ? enemyValue : Math.round(enemyValue * (damage / target.hp));
  const ownValueLoss = attackerDies ? ownValue : counterDamage > 0 ? Math.round(ownValue * (counterDamage / unit.hp)) : 0;
  const exchangeRatio = ownValueLoss > 0 ? enemyValueLoss / ownValueLoss : Infinity;

  let bonus = Math.round((enemyValueLoss - ownValueLoss) / COMBAT_VALUE_SCALE);
  const notes = [];
  if (exchangeRatio < 1) notes.push("Bad exchange");

  // 攻撃側が生き残る場合のみ、攻撃後の盤面価値(地形・支援・作戦目標・脅威)を評価する
  if (!attackerDies) {
    const terrain = terrainAt(state, dest.row, dest.col);
    if (terrain.defense > 0) {
      bonus += COMBAT_POSITION_BONUS.DEFENSIVE_TERRAIN;
      notes.push("Defensive terrain");
    }

    const alliesNearDest = situation.ownUnits.filter((u) => u.id !== unit.id && manhattan(u, dest) <= SUPPORT_RANGE).length;
    if (alliesNearDest > 0) {
      bonus += COMBAT_POSITION_BONUS.SUPPORTED;
      notes.push("Allied support nearby");
    }

    if (group && group.target) {
      const beforeDist = manhattan(unit, group.target);
      const afterDist = manhattan(dest, group.target);
      if (afterDist < beforeDist) {
        bonus += COMBAT_POSITION_BONUS.MISSION_APPROACH;
        notes.push("Approaching mission target");
      }
    }

    const destThreat = situation.threatMap[dest.row][dest.col];
    if (alliesNearDest === 0 && destThreat > COMBAT_THREAT_EXPOSURE_THRESHOLD) {
      bonus += COMBAT_POSITION_BONUS.THREAT_EXPOSURE;
      notes.push("Isolated at high-threat tile");
    }
  }

  if (isLethal && manhattan(target, situation.ownCapital) <= DEFEND_GROUP_RADIUS) {
    bonus += COMBAT_POSITION_BONUS.THREAT_REMOVED;
    notes.push("Removes threat near our capital");
  }

  return { bonus, notes, damage, counterDamage, enemyValueLoss, ownValueLoss, exchangeRatio };
}

function applyCombatBonus(candidates, state, unit, situation, group) {
  for (const c of candidates) {
    if (c.kind !== "attack") {
      c.combatBonus = 0;
      c.combatNotes = [];
      continue;
    }
    const evaluation = computeCombatBonus(state, unit, c, situation, group);
    c.combatBonus = evaluation.bonus;
    c.combatNotes = evaluation.notes;
    c.score += evaluation.bonus;
    logCombatEvaluation(unit, c.target, evaluation);
  }
}

// ユニット1体分の行動を評価値方式で決定する
// (候補を全て生成→作戦補正→グループ連携補正→作戦継続性補正→最高評価を採用)
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
  applyGroupBonus(candidates, state, unit, group, situation);
  applyMissionBonus(candidates, unit, group);
  applyThreatBonus(candidates, state, unit, group, ctx);
  applyCombatBonus(candidates, state, unit, ctx, group);

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

// AI司令部: ターン開始時に状況分析→作戦モード決定→作戦グループの継続/変更/破棄判定を行い、
// 各ユニットの役割と評価値(+作戦目標への貢献度+作戦継続性)に基づいて行動する
function createAIController(state, faction) {
  const threatMap = buildThreatMap(state, faction);
  const situation = analyzeSituation(state, faction);
  situation.threatMap = threatMap;
  situation.strategy = decideStrategy(situation);

  const memory = getAiMemory(state, faction);
  manageGuardGroups(state, situation, memory);
  const missionLogs = reviewAndFormGroups(state, situation, memory);

  situation.groups = memory.groups;
  situation.unitGroupMap = buildUnitGroupMap(situation.groups);

  async function takeTurn(animateMove) {
    if (AI_DEBUG) {
      console.debug(
        `[AI] === ターン${state.turn} ${faction}軍 状況分析 === 所持金${situation.money}G 自軍${situation.ownUnits.length}体 敵軍${situation.enemyUnits.length}体`
      );
      logThreatMap(state, situation);
      logStrategy(situation.strategy);
      logMissionReviews(missionLogs);
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
