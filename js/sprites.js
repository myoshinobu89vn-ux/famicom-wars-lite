// ユニット画像(ドット絵32x32を想定)の読み込み受け皿。
// assets/units/{type}_{faction}.png (例: soldier_player.png) を置くと自動的に
// 読み込まれ、render.js が円+文字の代替描画から画像描画へ切り替わる。
// 画像が未配置/読み込み失敗の場合は getUnitSprite() が null を返すだけなので、
// 何も置かなくても従来どおり動作する。

export const UNIT_SPRITE_SIZE = 48; // 想定するソース画像サイズ(ドット絵48x48)

const ASSET_DIR = "assets/units";
const cache = new Map();
let onReadyCallback = null;

// 画像が読み込み完了した際に呼ばれるコールバックを登録する(再描画のトリガー用)。
// 呼ばない場合でも動作はするが、初回描画時にまだ読み込みが終わっていない画像は
// 次に何らかの操作で再描画が起きるまでフォールバック表示のままになる。
export function onSpriteReady(callback) {
  onReadyCallback = callback;
}

function loadSprite(type, faction) {
  const key = `${type}_${faction}`;
  const entry = { img: new Image(), ready: false };
  entry.img.src = `${ASSET_DIR}/${key}.png`;
  entry.img.addEventListener("load", () => {
    entry.ready = true;
    if (onReadyCallback) onReadyCallback();
  });
  cache.set(key, entry);
  return entry;
}

// 読み込み済みならHTMLImageElementを、未配置/未読込ならnullを返す。
export function getUnitSprite(type, faction) {
  const key = `${type}_${faction}`;
  const entry = cache.get(key) || loadSprite(type, faction);
  return entry.ready ? entry.img : null;
}
