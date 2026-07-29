// 各モジュールの結線・ゲームループ・DOM連携

import { UNIT_TYPES } from "./data.js";
import { createInitialState, startTurn } from "./state.js";
import { checkGameOver } from "./state.js";
import { computeTileSize, resizeCanvasForDpr, drawScene, xyToRowCol } from "./render.js";
import { createInputController } from "./input.js";
import { runCpuTurn } from "./ai.js";
import { animateUnitMove } from "./animation.js";

const canvas = document.getElementById("board");
const boardWrap = document.getElementById("boardWrap");
const turnLabel = document.getElementById("turnLabel");
const moneyLabel = document.getElementById("moneyLabel");
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
const gameOverOverlay = document.getElementById("gameOverOverlay");
const gameOverText = document.getElementById("gameOverText");
const restartBtn = document.getElementById("restartBtn");

let state = createInitialState();
startTurn(state, "player");

let tileSize = 32;
let ctx = canvas.getContext("2d");
let pendingBuildTile = null;

function renderFrame(ui) {
  drawScene(ctx, state, tileSize, ui);
  actionBar.classList.toggle("hidden", !controller.isPostMove());
  const options = ui.postMoveOptions;
  attackBtn.disabled = !options || !options.canAttack;
  captureBtn.disabled = !options || !options.canCapture;
  updateUnitInfo(ui.selectedUnitInfo);
}

function updateUnitInfo(info) {
  if (!info) {
    unitInfo.classList.add("hidden");
    return;
  }
  const factionLabel = info.faction === "player" ? "あなた" : "CPU";
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
  const factionLabel = state.currentFaction === "player" ? "あなた" : "CPU";
  turnLabel.textContent = `ターン ${state.turn} - ${factionLabel}`;
  moneyLabel.textContent = `所持金: ${state.money.player}G`;
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
  const won = state.gameOver.winner === "player";
  gameOverText.textContent = won ? "勝利! 敵の首都を占領した" : "敗北... 首都を占領された";
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
  await runCpuTurn(state, animateUnit);
  checkGameOver(state);
  render();
  updateHud();
  if (showGameOverIfNeeded()) {
    endTurnBtn.disabled = false;
    return;
  }

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

restartBtn.addEventListener("click", () => {
  state = createInitialState();
  startTurn(state, "player");
  controller.clearSelection();
  hideBuildMenu();
  gameOverOverlay.classList.add("hidden");
  render();
  updateHud();
});

window.addEventListener("resize", render);

updateHud();
render();
