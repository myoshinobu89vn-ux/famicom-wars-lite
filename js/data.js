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

// マップ座標は [row][col]。8列×9行の縦長マップ(iPhone縦持ち画面向け)。
// 首都・工場の位置は INITIAL_SETUP 側で上書きする。
const layoutKeys = [
  "PPPPPPPP",
  "PFFPPFFP",
  "PFCPPCFP",
  "PPPWWPPP",
  "PPPCCPPP",
  "PPPWWPPP",
  "PFCPPCFP",
  "PFFPPFFP",
  "PPPPPPPP",
];

const keyToTerrain = {
  P: "PLAIN",
  F: "FOREST",
  W: "WATER",
  C: "CITY",
};

export const MAP_ROWS = layoutKeys.length;
export const MAP_COLS = layoutKeys[0].length;

export function buildMap() {
  return layoutKeys.map((rowStr) =>
    rowStr.split("").map((ch) => keyToTerrain[ch])
  );
}

// 初期配置: プレイヤーは北端(上)、CPUは南端(下)に首都・工場を配置
export const INITIAL_SETUP = {
  player: {
    capital: { row: 0, col: 0 },
    factory: { row: 0, col: MAP_COLS - 1 },
    units: [{ type: "soldier", row: 1, col: 3 }],
  },
  cpu: {
    capital: { row: MAP_ROWS - 1, col: MAP_COLS - 1 },
    factory: { row: MAP_ROWS - 1, col: 0 },
    units: [{ type: "soldier", row: MAP_ROWS - 2, col: MAP_COLS - 4 }],
  },
};

export const STARTING_MONEY = 300;
