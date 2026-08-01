// 各モジュールの結線・ゲームループ・DOM連携

import { UNIT_TYPES, listMaps, selectMap, getCurrentMapId } from "./data.js";
import { createInitialState, startTurn, factionStats } from "./state.js";
import { checkGameOver } from "./state.js";
import { computeTileSize, resizeCanvasForDpr, drawScene, xyToRowCol } from "./render.js";
import { createInputController } from "./input.js";
import { runCpuTurn } from "./ai.js";
import { animateUnitMove } from "./animation.js";
import { onSpriteReady } from "./sprites.js";

const canvas = document.getElementById("board");
const boardWrap = document.getElementById("boardWrap");
const turnLabel = document.getElementById("turnLabel");
const statsBar = document.getElementById("statsBar");
const endTurnBtn = document.getElementById("endTurnBtn");
const buildMenu = document.getElementById("buildMenu");
const buildSoldierBtn = document.getElementById("buildSoldier");
const buildTankBtn = document.getElementById("buildTank");
const cancelBuildBtn = document.getElementById("cancelBuild");
const actionBar = document.getElementById("actionBar");
const attackBtn = document.getElementById("attackBtn");
const captureBtn = document.getElementById("captureBtn");
const waitBtn = document.getElementById("waitBtn");
const cancelMoveBtn = document.getElementById("cancelMoveBtn");
const unitInfo = document.getElementById("unitInfo");
const turnBanner = document.getElementById("turnBanner");
const gameOverOverlay = document.getElementById("gameOverOverlay");
const gameOverText = document.getElementById("gameOverText");
const restartBtn = document.getElementById("restartBtn");
const mapSelect = document.getElementById("mapSelect");
const saveBtn = document.getElementById("saveBtn");
const loadBtn = document.getElementById("loadBtn");
const saveLoadOverlay = document.getElementById("saveLoadOverlay");
const saveLoadTitle = document.getElementById("saveLoadTitle");
const saveLoadSlots = document.getElementById("saveLoadSlots");
const cancelSaveLoad = document.getElementById("cancelSaveLoad");

const SAVE_SLOTS_KEY = "savegame_slots";
const SAVE_SLOT_COUNT = 10;

for (const { id, label } of listMaps()) {
  const opt = document.createElement("option");
  opt.value = id;
  opt.textContent = label;
  mapSelect.appendChild(opt);
}
mapSelect.value = getCurrentMapId();

let state = createInitialState();
startTurn(state, "player");

let tileSize = 32;
let ctx = canvas.getContext("2d");
let pendingBuildTile = null;
let lastTurnKey = null;
let turnBannerTimer = null;

function renderFrame(ui) {
  drawScene(ctx, state, tileSize, ui);
  actionBar.classList.toggle("hidden", !controller.isPostMove());
  const options = ui.postMoveOptions;
  const targetCount = ui.attackTargetKeys ? ui.attackTargetKeys.size : 0;
  attackBtn.disabled = !options || !options.canAttack;
  // 隣接する敵が複数いる場合はボタンでは一意に選べないため、枠カーソルが付いた
  // 敵ユニットを直接タップして選ぶよう促す(タップ側の攻撃処理は対象数に関わらず動作する)
  attackBtn.textContent = targetCount > 1 ? "攻撃(対象をタップ)" : "攻撃";
  captureBtn.disabled = !options || !options.canCapture;
  updateUnitInfo(ui.selectedUnitInfo);
}

function updateUnitInfo(info) {
  if (!info) {
    unitInfo.classList.add("hidden");
    return;
  }
  const factionLabel = info.faction === "player" ? "You" : "CPU";
  unitInfo.innerHTML = `
    <div class="unitInfoTitle">${info.label}(${factionLabel})</div>
    <div class="unitInfoRow"><span>HP</span><span class="value">${info.hp}/${info.maxHp}</span></div>
    <div class="unitInfoRow"><span>移動力</span><span class="value">${info.move}</span></div>
    <div class="unitInfoRow"><span>攻撃力</span><span class="value">${info.power}</span></div>
  `;
  unitInfo.classList.remove("hidden");
}

function render() {
  tileSize = computeTileSize(boardWrap);
  ctx = resizeCanvasForDpr(canvas, tileSize);
  renderFrame(controller.getUiState());
}

// ユニットの移動を経路に沿ってスライドさせる(演出なし、位置補間のみ)
function animateUnit(unit, path) {
  return animateUnitMove(path, (row, col) => {
    renderFrame({ ...controller.getUiState(), animatingUnit: { id: unit.id, row, col } });
  });
}

function updateHud() {
  const factionLabel = state.currentFaction === "player" ? "You" : "CPU";
  const turnText = `ターン ${state.turn} - ${factionLabel}`;
  turnLabel.textContent = turnText;
  updateStatsBar();

  if (showGameOverIfNeeded()) {
    endTurnBtn.disabled = true;
    return;
  }

  const turnKey = `${state.turn}-${state.currentFaction}`;
  if (turnKey !== lastTurnKey) {
    const isGameStart = lastTurnKey === null;
    lastTurnKey = turnKey;
    showTurnBanner(isGameStart ? "作戦開始!" : turnText);
  }
}

// ターン切り替わりを画面中央に一時表示し、誰の番か分かりやすくする
function showTurnBanner(text) {
  turnBanner.textContent = text;
  turnBanner.classList.add("visible");
  clearTimeout(turnBannerTimer);
  turnBannerTimer = setTimeout(() => {
    turnBanner.classList.remove("visible");
  }, 1400);
}

function renderFactionStats(faction, label, cssClass) {
  const s = factionStats(state, faction);
  return `
    <div class="factionStats ${cssClass}">
      <span class="factionLabel">${label}</span>
      <span class="stat">資金 <b>${s.money}G</b></span>
      <span class="stat">工場 <b>${s.factories}</b></span>
      <span class="stat">都市 <b>${s.cities}</b></span>
      <span class="stat">ユニット数 <b>${s.units}</b></span>
    </div>
  `;
}

function updateStatsBar() {
  statsBar.innerHTML =
    renderFactionStats("player", "You", "player") + renderFactionStats("cpu", "CPU", "cpu");
}

function showBuildMenu(tile) {
  pendingBuildTile = tile;
  buildSoldierBtn.textContent = `兵士 (${UNIT_TYPES.soldier.cost}G)`;
  buildSoldierBtn.disabled = state.money.player < UNIT_TYPES.soldier.cost;
  buildTankBtn.textContent = `戦車 (${UNIT_TYPES.tank.cost}G)`;
  buildTankBtn.disabled = state.money.player < UNIT_TYPES.tank.cost;
  buildMenu.classList.remove("hidden");
}

function hideBuildMenu() {
  pendingBuildTile = null;
  buildMenu.classList.add("hidden");
}

const controller = createInputController({
  getState: () => state,
  requestRender: render,
  updateHud,
  showBuildMenu,
  hideBuildMenu,
  isPlayerTurn: () => state.currentFaction === "player" && !state.gameOver,
  animateMove: animateUnit,
});

function pointerToTile(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  return xyToRowCol(x, y, tileSize);
}

canvas.addEventListener("pointerup", (e) => {
  if (state.currentFaction !== "player" || state.gameOver) return;
  const { row, col } = pointerToTile(e.clientX, e.clientY);
  controller.handleTileTap(row, col);
});

buildSoldierBtn.addEventListener("click", () => {
  if (pendingBuildTile) controller.build("soldier", pendingBuildTile);
});
buildTankBtn.addEventListener("click", () => {
  if (pendingBuildTile) controller.build("tank", pendingBuildTile);
});
cancelBuildBtn.addEventListener("click", () => {
  hideBuildMenu();
  render();
});
attackBtn.addEventListener("click", () => {
  controller.handleAttack();
});
captureBtn.addEventListener("click", () => {
  controller.handleCapture();
});
waitBtn.addEventListener("click", () => {
  controller.handleWait();
});
cancelMoveBtn.addEventListener("click", () => {
  controller.handleCancelMove();
});

function showGameOverIfNeeded() {
  if (!state.gameOver) return false;
  const { winner, reason } = state.gameOver;
  const won = winner === "player";
  const winText = reason === "annihilation" ? "勝利! 敵ユニットを全滅させた" : "勝利! 敵の首都を占領した";
  const loseText = reason === "annihilation" ? "敗北... ユニットが全滅した" : "敗北... 首都を占領された";
  gameOverText.textContent = won ? winText : loseText;
  gameOverOverlay.classList.remove("hidden");
  return true;
}

async function endPlayerTurn() {
  if (state.gameOver || state.currentFaction !== "player" || controller.isAnimating()) return;
  controller.clearSelection();
  hideBuildMenu();

  endTurnBtn.disabled = true;
  state.currentFaction = "cpu";
  startTurn(state, "cpu");
  render();
  updateHud(); // CPUのターンに切り替わったことを即座に表示する
  await runCpuTurn(state, animateUnit);
  checkGameOver(state);
  render();
  updateHud();
  if (state.gameOver) return;

  state.turn += 1;
  state.currentFaction = "player";
  startTurn(state, "player");
  render();
  updateHud();
  endTurnBtn.disabled = false;
}

endTurnBtn.addEventListener("click", () => {
  endPlayerTurn();
});

function resetGame() {
  state = createInitialState();
  startTurn(state, "player");
  controller.clearSelection();
  hideBuildMenu();
  gameOverOverlay.classList.add("hidden");
  endTurnBtn.disabled = false;
  lastTurnKey = null;
  render();
  updateHud();
}

restartBtn.addEventListener("click", () => {
  resetGame();
});

mapSelect.addEventListener("change", () => {
  selectMap(mapSelect.value);
  resetGame();
});

// state自体はプレーンなJSONとして丸ごと保存する(state.jsの構造は変更しない)。
// マップ選択(MAP_ROWS/MAP_COLS/INITIAL_SETUP)はdata.js側のモジュール変数で
// stateの外にあるため、現在選択中のマップIDも合わせて保存する。
// 複数スロット(SAVE_SLOT_COUNT個)をひとつの配列としてlocalStorageへ保存する。
function loadAllSlots() {
  try {
    const raw = localStorage.getItem(SAVE_SLOTS_KEY);
    const slots = raw ? JSON.parse(raw) : [];
    return Array.isArray(slots) ? slots : [];
  } catch (err) {
    console.error("セーブデータの読み込みに失敗しました", err);
    return [];
  }
}

function writeAllSlots(slots) {
  localStorage.setItem(SAVE_SLOTS_KEY, JSON.stringify(slots));
}

function formatSlotMeta(entry) {
  if (!entry || !entry.state) return "(空き)";
  const factionLabel = entry.state.currentFaction === "player" ? "You" : "CPU";
  const date = new Date(entry.savedAt);
  const dateText = Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
  return `ターン${entry.state.turn} - ${factionLabel} / ${dateText}`;
}

function openSaveLoadOverlay(mode) {
  const slots = loadAllSlots();
  saveLoadTitle.textContent = mode === "save" ? "セーブ先を選択" : "ロードするデータを選択";
  saveLoadSlots.innerHTML = "";
  for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
    const entry = slots.find((s) => s.slot === i);
    const btn = document.createElement("button");
    btn.innerHTML = `スロット${i + 1}<span class="slotMeta">${formatSlotMeta(entry)}</span>`;
    if (mode === "load" && !entry) btn.disabled = true;
    btn.addEventListener("click", () => {
      if (mode === "save") saveToSlot(i);
      else loadFromSlot(i);
      saveLoadOverlay.classList.add("hidden");
    });
    saveLoadSlots.appendChild(btn);
  }
  saveLoadOverlay.classList.remove("hidden");
}

function saveToSlot(slotIndex) {
  try {
    const slots = loadAllSlots().filter((s) => s.slot !== slotIndex);
    slots.push({ slot: slotIndex, mapId: getCurrentMapId(), savedAt: new Date().toISOString(), state });
    writeAllSlots(slots);
    showTurnBanner(`スロット${slotIndex + 1}にセーブしました`);
  } catch (err) {
    console.error("セーブに失敗しました", err);
    alert("セーブに失敗しました");
  }
}

function loadFromSlot(slotIndex) {
  const entry = loadAllSlots().find((s) => s.slot === slotIndex);
  if (!entry || !entry.state || !entry.mapId) {
    alert("このスロットにはセーブデータがありません");
    return;
  }

  selectMap(entry.mapId);
  mapSelect.value = entry.mapId;
  state = entry.state;
  controller.clearSelection();
  hideBuildMenu();
  gameOverOverlay.classList.toggle("hidden", !state.gameOver);
  endTurnBtn.disabled = !!state.gameOver || state.currentFaction !== "player";
  lastTurnKey = `${state.turn}-${state.currentFaction}`; // ロード直後に自動でターンバナーが出ないようにする
  render();
  updateHud();
  showTurnBanner(`スロット${slotIndex + 1}をロードしました`);
}

saveBtn.addEventListener("click", () => openSaveLoadOverlay("save"));
loadBtn.addEventListener("click", () => openSaveLoadOverlay("load"));
cancelSaveLoad.addEventListener("click", () => {
  saveLoadOverlay.classList.add("hidden");
});

window.addEventListener("resize", render);
onSpriteReady(render); // ユニット画像の読み込み完了時に再描画してフォールバック表示から切り替える

updateHud();
render();
