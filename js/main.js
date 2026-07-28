// 各モジュールの結線・ゲームループ・DOM連携

import { UNIT_TYPES } from "./data.js";
import { createInitialState, startTurn } from "./state.js";
import { checkGameOver } from "./state.js";
import { computeTileSize, resizeCanvasForDpr, drawScene, xyToRowCol } from "./render.js";
import { createInputController } from "./input.js";
import { runCpuTurn } from "./ai.js";

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
const waitBtn = document.getElementById("waitBtn");
const gameOverOverlay = document.getElementById("gameOverOverlay");
const gameOverText = document.getElementById("gameOverText");
const restartBtn = document.getElementById("restartBtn");

let state = createInitialState();
startTurn(state, "player");

let tileSize = 32;
let ctx = canvas.getContext("2d");
let pendingBuildTile = null;

function render() {
  tileSize = computeTileSize(boardWrap);
  ctx = resizeCanvasForDpr(canvas, tileSize);
  drawScene(ctx, state, tileSize, controller.getUiState());
  actionBar.classList.toggle("hidden", !controller.isPostMove());
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
waitBtn.addEventListener("click", () => {
  controller.handleWait();
});

function showGameOverIfNeeded() {
  if (!state.gameOver) return false;
  const won = state.gameOver.winner === "player";
  gameOverText.textContent = won ? "勝利! 敵の首都を占領した" : "敗北... 首都を占領された";
  gameOverOverlay.classList.remove("hidden");
  return true;
}

function endPlayerTurn() {
  if (state.gameOver) return;
  controller.clearSelection();
  hideBuildMenu();

  state.currentFaction = "cpu";
  startTurn(state, "cpu");
  runCpuTurn(state);
  checkGameOver(state);
  render();
  updateHud();
  if (showGameOverIfNeeded()) return;

  state.turn += 1;
  state.currentFaction = "player";
  startTurn(state, "player");
  render();
  updateHud();
}

endTurnBtn.addEventListener("click", endPlayerTurn);

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
