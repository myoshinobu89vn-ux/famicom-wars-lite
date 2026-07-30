// 地形・ユニット・マップの静的データ定義

export const TERRAIN = {
  PLAIN: {
    id: "PLAIN",
    label: "平地",
    color: "#bfe08a",
    defense: 0,
    capturable: false,
    income: 0,
    moveCost: { soldier: 1, tank: 1 },
  },
  FOREST: {
    id: "FOREST",
    label: "森",
    color: "#3f7d3f",
    defense: 1,
    capturable: false,
    income: 0,
    moveCost: { soldier: 1, tank: 2 },
  },
  WATER: {
    id: "WATER",
    label: "水",
    color: "#5fa8d3",
    defense: 0,
    capturable: false,
    income: 0,
    moveCost: { soldier: Infinity, tank: Infinity },
  },
  CITY: {
    id: "CITY",
    label: "都市",
    color: "#c9c9c9",
    defense: 1,
    capturable: true,
    income: 100,
    moveCost: { soldier: 1, tank: 1 },
  },
  FACTORY: {
    id: "FACTORY",
    label: "工場",
    color: "#a0895c",
    defense: 2,
    capturable: true,
    producible: true,
    income: 100,
    moveCost: { soldier: 1, tank: 1 },
  },
  CAPITAL: {
    id: "CAPITAL",
    label: "首都",
    color: "#e0b84c",
    defense: 2,
    capturable: true,
    producible: true,
    income: 100,
    moveCost: { soldier: 1, tank: 1 },
  },
};

export const UNIT_TYPES = {
  soldier: {
    id: "soldier",
    label: "兵士",
    cost: 100,
    hp: 10,
    move: 3,
    power: 4,
    canCapture: true,
  },
  tank: {
    id: "tank",
    label: "戦車",
    cost: 300,
    hp: 10,
    move: 5,
    power: 6,
    canCapture: false,
  },
};

// マップ座標は [row][col]。マップごとに layoutKeys(地形文字列)+legend(文字→地形ID)+
// initialSetup(首都・工場・初期ユニット)を1セットの定義として MAP_DEFS にまとめ、
// selectMap() で切り替える。首都・工場の座標は各マップの initialSetup 側で上書きする
// (従来どおり。地形文字列自体には首都/自軍所有工場を表す文字は含めない)。
const MAP_DEFS = {
  // 従来からの標準マップ(8列×9行、iPhone縦持ち画面向け)。デフォルト選択。
  classic: {
    label: "デフォルトマップ",
    legend: { P: "PLAIN", F: "FOREST", W: "WATER", C: "CITY" },
    layoutKeys: [
      "PPPPPPPP",
      "PFFPPFFP",
      "PFCPPCFP",
      "PPPWWPPP",
      "PPPCCPPP",
      "PPPWWPPP",
      "PFCPPCFP",
      "PFFPPFFP",
      "PPPPPPPP",
    ],
    initialSetup: {
      player: {
        capital: { row: 0, col: 0 },
        factory: { row: 0, col: 7 },
        units: [{ type: "soldier", row: 1, col: 3 }],
      },
      cpu: {
        capital: { row: 8, col: 7 },
        factory: { row: 8, col: 0 },
        units: [{ type: "soldier", row: 7, col: 4 }],
      },
    },
  },

  // Map1: 中央突破作戦(12×12・標準プレイ用)。左右対称・上下は180度回転対称で
  // 両軍の条件を完全に同等にしてある。中央に争奪価値の高い都市クラスタ、
  // 両軍それぞれの前線寄りに中立工場を2つずつ配置し、森と川で進軍ルートに
  // 選択肢を作る。
  centralBreakthrough: {
    label: "中央突破作戦",
    legend: { ".": "PLAIN", T: "FOREST", "~": "WATER", C: "CITY", F: "FACTORY" },
    layoutKeys: [
      "...T....T...",
      ".C........C.",
      "..F..~~..F..",
      "T....~~....T",
      "..C.T..T.C..",
      ".....CC.....",
      ".....CC.....",
      "..C.T..T.C..",
      "T....~~....T",
      "..F..~~..F..",
      ".C........C.",
      "...T....T...",
    ],
    initialSetup: {
      player: {
        capital: { row: 0, col: 0 },
        factory: { row: 0, col: 11 },
        units: [
          { type: "soldier", row: 1, col: 3 },
          { type: "soldier", row: 1, col: 8 },
          { type: "tank", row: 2, col: 4 },
        ],
      },
      cpu: {
        capital: { row: 11, col: 11 },
        factory: { row: 11, col: 0 },
        units: [
          { type: "soldier", row: 10, col: 8 },
          { type: "soldier", row: 10, col: 3 },
          { type: "tank", row: 9, col: 7 },
        ],
      },
    },
  },

  // Map2: 二正面作戦(12×12・AI評価用)。中央を川で分断し、価値目標(都市・工場)を
  // 左右両翼と自軍領内奥に分散配置。一方向への戦力集中だけでは両翼を同時に守れない
  // 構造にし、複数作戦グループ・Threat Mapによる防衛判断・ミッション継続を評価する。
  twoFront: {
    label: "二正面作戦",
    legend: { ".": "PLAIN", T: "FOREST", "~": "WATER", C: "CITY", F: "FACTORY" },
    layoutKeys: [
      "....T..T....",
      ".C........C.",
      "..F......F..",
      "....~~~~....",
      "....~~~~....",
      "C..........C",
      "C..........C",
      "....~~~~....",
      "....~~~~....",
      "..F......F..",
      ".C........C.",
      "....T..T....",
    ],
    initialSetup: {
      player: {
        capital: { row: 0, col: 0 },
        factory: { row: 0, col: 11 },
        units: [
          { type: "soldier", row: 2, col: 1 },
          { type: "soldier", row: 2, col: 10 },
          { type: "tank", row: 1, col: 5 },
        ],
      },
      cpu: {
        capital: { row: 11, col: 11 },
        factory: { row: 11, col: 0 },
        units: [
          { type: "soldier", row: 9, col: 10 },
          { type: "soldier", row: 9, col: 1 },
          { type: "tank", row: 10, col: 6 },
        ],
      },
    },
  },
};

let currentMapId = "classic";

// 選択可能なマップ一覧({id, label}[])。UI側のマップ選択メニュー用。
export function listMaps() {
  return Object.entries(MAP_DEFS).map(([id, def]) => ({ id, label: def.label }));
}

export function getCurrentMapId() {
  return currentMapId;
}

// マップを切り替える。以降の buildMap()/MAP_ROWS/MAP_COLS/INITIAL_SETUP は
// 選択中マップの内容を返す(createInitialState() より前に呼ぶこと)。
export function selectMap(id) {
  if (!MAP_DEFS[id]) throw new Error(`未知のマップID: ${id}`);
  currentMapId = id;
  const def = MAP_DEFS[id];
  MAP_ROWS = def.layoutKeys.length;
  MAP_COLS = def.layoutKeys[0].length;
  INITIAL_SETUP = def.initialSetup;
}

export function buildMap() {
  const def = MAP_DEFS[currentMapId];
  return def.layoutKeys.map((rowStr) => rowStr.split("").map((ch) => def.legend[ch]));
}

// MAP_ROWS/MAP_COLS/INITIAL_SETUP は selectMap() で切り替わるライブバインディング。
// state.js/grid.js/ai.js/render.js はいずれも関数内で都度参照しているため、
// これらのファイルを変更せずにマップ切替に追従できる。
export let MAP_ROWS = MAP_DEFS[currentMapId].layoutKeys.length;
export let MAP_COLS = MAP_DEFS[currentMapId].layoutKeys[0].length;
export let INITIAL_SETUP = MAP_DEFS[currentMapId].initialSetup;

export const STARTING_MONEY = 300;
