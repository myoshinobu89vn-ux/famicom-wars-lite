// ユニット移動のスライドアニメーション(位置補間のみ、演出なし)

const MS_PER_TILE = 120;

/**
 * path (computeReachable の path: [[row,col], ...] 、start を含む) に沿って
 * 一定速度でスライドさせる。1フレームごとに onFrame(row, col) を呼ぶ(小数座標)。
 * 戻り値: アニメーション完了時に解決される Promise。
 */
export function animateUnitMove(path, onFrame) {
  if (!path || path.length <= 1) return Promise.resolve();

  const steps = path.length - 1;
  const duration = steps * MS_PER_TILE;

  return new Promise((resolve) => {
    let startTime = null;

    function step(now) {
      if (startTime === null) startTime = now;
      const t = Math.min((now - startTime) / duration, 1);
      const stepFloat = t * steps;
      const idx = Math.min(Math.floor(stepFloat), steps - 1);
      const localT = t === 1 ? 1 : stepFloat - idx;
      const [r0, c0] = path[idx];
      const [r1, c1] = path[idx + 1];
      onFrame(r0 + (r1 - r0) * localT, c0 + (c1 - c0) * localT);

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        resolve();
      }
    }

    requestAnimationFrame(step);
  });
}
