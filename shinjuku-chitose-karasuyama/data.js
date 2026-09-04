// 新宿駅 京王線 下り(京王八王子・橋本・高尾山口方面)時刻表データ
// 出典: 乗換案内サイトの新宿駅時刻表表示(2026年8月16日時点)をもとにユーザーが書き起こしたデータ。
// 姉妹アプリ「chitose-karasuyama-shinjuku」(千歳烏山発・2026年8月17日改正)とは
// 取得時点・出典が異なるため、細部の時刻が完全には一致しない可能性がある。
// 土休日ダイヤは未取得のため未対応(平日データのみ)。

// 新宿→千歳烏山の所要時分(分)。
// 姉妹アプリ(千歳烏山→新宿)で採用している所要時分を、往復で同じと仮定してそのまま流用している。
// 特急12分・区間急行14分は姉妹アプリ側で複数の乗換案内サイトから確認済みの値。
// 急行は区間急行と同一(未確認)、快速・各停20分は概算値。上り下りで所要時分が異なる可能性があり未確認。
const DURATION_MIN = {
  tokkyu: 12,
  kyuko: 14,
  kukan_kyuko: 14,
  kaisoku: 20,
  kakutei: 20,
};

const TYPE_LABEL = {
  tokkyu: '特急',
  kyuko: '急行',
  kukan_kyuko: '区間急行',
  kaisoku: '快速',
  kakutei: '各停',
  // 京王ライナーは時刻表には掲載するが、千歳烏山を通過するため一覧・比較の対象からは除外する。
  keio_liner: '京王ライナー',
};

// 種別ごとの表示用の強さ(速達性が高いほど大きい値。バッジの色分けに利用)
const TYPE_RANK = {
  tokkyu: 5,
  kyuko: 4,
  kukan_kyuko: 3,
  kaisoku: 2,
  kakutei: 1,
};

const DEST_LABEL = {
  keio_hachioji: '京王八王子',
  hashimoto: '橋本',
  takaosanguchi: '高尾山口',
  takahatafudo: '高幡不動',
  keio_tama_center: '京王多摩センター',
  wakabadai: '若葉台',
  tsutsujigaoka: 'つつじヶ丘',
  chofu: '調布',
  sakurajosui: '桜上水',
};

// 桜上水は新宿と千歳烏山の間(新宿寄り)にある駅のため、桜上水行きの電車は
// 千歳烏山に到達しない。一覧・比較の対象から除外する。
const NOT_REACHING_KARASUYAMA = new Set(['sakurajosui']);

// 京王ライナーは新宿発車後、千歳烏山を含む多くの中間駅を通過するため乗車しても降車できない
// (未確認・一般に知られている運行形態に基づく仮定)。一覧・比較の対象から除外する。
const NOT_STOPPING_TYPES = new Set(['keio_liner']);

// [発車時刻(HH:MM), 種別, 行き先]
// 種別は新宿→千歳烏山間の走行パターンを表す(例: 「特急 高幡不動から各駅停車」は
// 千歳烏山通過時点ではまだ特急運転のため tokkyu として扱う)。
// 行き先が「高尾行き」と表示されていた1件(20:02)は京王線に「高尾」という駅がないため、
// 「高尾山口」の表記ゆれ(誤記)とみなし takaosanguchi として扱っている(要確認)。
const WEEKDAY_RAW = [
  ['05:29', 'tokkyu', 'keio_hachioji'],
  ['05:38', 'kakutei', 'keio_hachioji'],
  ['05:47', 'kyuko', 'keio_hachioji'],
  ['05:55', 'kakutei', 'hashimoto'],

  ['06:01', 'kakutei', 'keio_hachioji'],
  ['06:08', 'kyuko', 'keio_hachioji'],
  ['06:13', 'kakutei', 'hashimoto'],
  ['06:18', 'kaisoku', 'takaosanguchi'],
  ['06:22', 'kakutei', 'takaosanguchi'],
  ['06:24', 'kakutei', 'sakurajosui'],
  ['06:29', 'tokkyu', 'keio_hachioji'],
  ['06:33', 'kakutei', 'keio_hachioji'],
  ['06:37', 'kakutei', 'chofu'],
  ['06:41', 'kukan_kyuko', 'hashimoto'],
  ['06:44', 'tokkyu', 'keio_hachioji'],
  ['06:45', 'kakutei', 'takaosanguchi'],
  ['06:49', 'kukan_kyuko', 'hashimoto'],
  ['06:50', 'kakutei', 'takaosanguchi'],
  ['06:51', 'kakutei', 'sakurajosui'],
  ['06:56', 'tokkyu', 'keio_hachioji'],
  ['06:57', 'kakutei', 'takaosanguchi'],

  ['07:01', 'kakutei', 'sakurajosui'],
  ['07:03', 'tokkyu', 'takaosanguchi'],
  ['07:04', 'kakutei', 'sakurajosui'],
  ['07:10', 'kakutei', 'hashimoto'],
  ['07:15', 'tokkyu', 'keio_hachioji'],
  ['07:17', 'kakutei', 'takaosanguchi'],
  ['07:18', 'kakutei', 'sakurajosui'],
  ['07:21', 'kyuko', 'keio_hachioji'],
  ['07:26', 'kakutei', 'takaosanguchi'],
  ['07:29', 'kukan_kyuko', 'hashimoto'],
  ['07:30', 'kakutei', 'sakurajosui'],
  ['07:33', 'kakutei', 'takaosanguchi'],
  ['07:37', 'tokkyu', 'keio_hachioji'],
  ['07:41', 'kakutei', 'keio_hachioji'],
  ['07:42', 'kukan_kyuko', 'hashimoto'],
  ['07:47', 'tokkyu', 'keio_hachioji'],
  ['07:49', 'kakutei', 'takaosanguchi'],
  ['07:53', 'tokkyu', 'keio_hachioji'],
  ['07:54', 'kakutei', 'takaosanguchi'],
  ['07:56', 'kakutei', 'takaosanguchi'],

  ['08:01', 'tokkyu', 'keio_hachioji'],
  ['08:03', 'kakutei', 'takaosanguchi'],
  ['08:04', 'kakutei', 'sakurajosui'],
  ['08:10', 'tokkyu', 'takaosanguchi'],
  ['08:11', 'kakutei', 'takahatafudo'],
  ['08:16', 'kyuko', 'hashimoto'],
  ['08:19', 'tokkyu', 'keio_hachioji'],
  ['08:20', 'kakutei', 'keio_hachioji'],
  ['08:24', 'kukan_kyuko', 'hashimoto'],
  ['08:27', 'tokkyu', 'keio_hachioji'],
  ['08:28', 'kakutei', 'takaosanguchi'],
  ['08:32', 'tokkyu', 'keio_tama_center'],
  ['08:35', 'tokkyu', 'keio_hachioji'],
  ['08:36', 'kakutei', 'keio_hachioji'],
  ['08:40', 'kyuko', 'hashimoto'],
  ['08:43', 'tokkyu', 'keio_hachioji'],
  ['08:44', 'kakutei', 'sakurajosui'],
  ['08:48', 'kyuko', 'takahatafudo'],
  ['08:51', 'tokkyu', 'keio_hachioji'],
  ['08:52', 'kakutei', 'takaosanguchi'],
  ['08:56', 'tokkyu', 'takaosanguchi'],
  ['08:57', 'kyuko', 'hashimoto'],
  ['08:58', 'kakutei', 'wakabadai'],

  ['09:02', 'kukan_kyuko', 'wakabadai'],
  ['09:04', 'kakutei', 'takaosanguchi'],
  ['09:05', 'tokkyu', 'keio_tama_center'],
  ['09:08', 'tokkyu', 'keio_hachioji'],
  ['09:11', 'kakutei', 'keio_hachioji'],
  ['09:13', 'kakutei', 'sakurajosui'],
  ['09:16', 'tokkyu', 'takaosanguchi'],
  ['09:19', 'kakutei', 'keio_tama_center'],
  ['09:21', 'kakutei', 'sakurajosui'],
  ['09:24', 'kyuko', 'keio_hachioji'],
  ['09:26', 'kakutei', 'tsutsujigaoka'],
  ['09:29', 'kaisoku', 'takaosanguchi'],
  ['09:32', 'kakutei', 'sakurajosui'],
  ['09:37', 'kakutei', 'keio_hachioji'],
  ['09:40', 'tokkyu', 'keio_hachioji'],
  ['09:43', 'kakutei', 'takaosanguchi'],
  ['09:44', 'tokkyu', 'keio_tama_center'],
  ['09:48', 'tokkyu', 'takaosanguchi'],
  ['09:50', 'tokkyu', 'keio_tama_center'],
  ['09:51', 'kakutei', 'keio_hachioji'],
  ['09:57', 'kakutei', 'sakurajosui'],
];

// 10時台〜14時台は日中パターンとして同一(ユーザー提供データより)。
// 誤入力を避けるため、1時間分をテンプレート化して各時間へ展開する。
const DAYTIME_PATTERN_TEMPLATE = [
  ['00', 'tokkyu', 'keio_hachioji'],
  ['02', 'kakutei', 'takaosanguchi'],
  ['06', 'tokkyu', 'hashimoto'],
  ['10', 'tokkyu', 'takaosanguchi'],
  ['12', 'kakutei', 'keio_hachioji'],
  ['20', 'tokkyu', 'keio_hachioji'],
  ['22', 'kakutei', 'takaosanguchi'],
  ['26', 'tokkyu', 'hashimoto'],
  ['30', 'tokkyu', 'takaosanguchi'],
  ['32', 'kakutei', 'keio_hachioji'],
  ['40', 'tokkyu', 'keio_hachioji'],
  ['42', 'kakutei', 'takaosanguchi'],
  ['46', 'tokkyu', 'hashimoto'],
  ['50', 'tokkyu', 'takaosanguchi'],
  ['52', 'kakutei', 'keio_hachioji'],
];
WEEKDAY_RAW.push(
  // 10時台は日中パターンと微妙に異なる(:15 の追加便・:33 桜上水行きなど)ため個別に記載。
  ['10:00', 'tokkyu', 'keio_hachioji'],
  ['10:04', 'kakutei', 'takaosanguchi'],
  ['10:06', 'tokkyu', 'hashimoto'],
  ['10:10', 'tokkyu', 'takaosanguchi'],
  ['10:15', 'kakutei', 'keio_hachioji'],
  ['10:20', 'tokkyu', 'keio_hachioji'],
  ['10:21', 'kakutei', 'takahatafudo'],
  ['10:26', 'tokkyu', 'hashimoto'],
  ['10:30', 'tokkyu', 'takaosanguchi'],
  ['10:32', 'kakutei', 'keio_hachioji'],
  ['10:33', 'kakutei', 'sakurajosui'],
  ['10:40', 'tokkyu', 'keio_hachioji'],
  ['10:42', 'kakutei', 'takaosanguchi'],
  ['10:46', 'tokkyu', 'hashimoto'],
  ['10:50', 'tokkyu', 'takaosanguchi'],
  ['10:52', 'kakutei', 'keio_hachioji'],
);

for (const hour of [11, 12]) {
  for (const [min, type, dest] of DAYTIME_PATTERN_TEMPLATE) {
    WEEKDAY_RAW.push([`${String(hour).padStart(2, '0')}:${min}`, type, dest]);
  }
}
// 13時台は :52 のみ日中パターンと異なる(高幡不動行き)。
for (const [min, type, dest] of DAYTIME_PATTERN_TEMPLATE) {
  WEEKDAY_RAW.push(['13:' + min, type, min === '52' ? 'takahatafudo' : dest]);
}
for (const [min, type, dest] of DAYTIME_PATTERN_TEMPLATE) {
  WEEKDAY_RAW.push(['14:' + min, type, dest]);
}

WEEKDAY_RAW.push(
  ['15:00', 'tokkyu', 'keio_hachioji'],
  ['15:02', 'kakutei', 'takaosanguchi'],
  ['15:06', 'tokkyu', 'hashimoto'],
  ['15:10', 'tokkyu', 'takaosanguchi'],
  ['15:12', 'kakutei', 'takaosanguchi'],
  ['15:20', 'tokkyu', 'keio_hachioji'],
  ['15:22', 'kakutei', 'keio_hachioji'],
  ['15:26', 'tokkyu', 'hashimoto'],
  ['15:30', 'tokkyu', 'takaosanguchi'],
  ['15:32', 'kakutei', 'keio_hachioji'],
  ['15:40', 'tokkyu', 'keio_hachioji'],
  ['15:42', 'kakutei', 'keio_hachioji'],
  ['15:46', 'tokkyu', 'hashimoto'],
  ['15:50', 'tokkyu', 'keio_hachioji'],
  ['15:52', 'kakutei', 'takahatafudo'],

  ['16:00', 'tokkyu', 'keio_hachioji'],
  ['16:03', 'kakutei', 'keio_hachioji'],
  ['16:06', 'tokkyu', 'hashimoto'],
  ['16:10', 'tokkyu', 'keio_hachioji'],
  ['16:12', 'kakutei', 'takaosanguchi'],
  ['16:20', 'tokkyu', 'keio_hachioji'],
  ['16:23', 'kakutei', 'takaosanguchi'],
  ['16:29', 'tokkyu', 'hashimoto'],
  ['16:31', 'tokkyu', 'keio_hachioji'],
  ['16:32', 'kakutei', 'takaosanguchi'],
  ['16:40', 'keio_liner', 'hashimoto'],
  ['16:41', 'tokkyu', 'keio_hachioji'],
  ['16:42', 'kakutei', 'takaosanguchi'],
  ['16:49', 'tokkyu', 'hashimoto'],
  ['16:51', 'tokkyu', 'keio_hachioji'],
  ['16:52', 'kakutei', 'takaosanguchi'],

  ['17:00', 'keio_liner', 'keio_hachioji'],
  ['17:01', 'tokkyu', 'keio_hachioji'],
  ['17:02', 'kakutei', 'takaosanguchi'],
  ['17:09', 'tokkyu', 'hashimoto'],
  ['17:11', 'tokkyu', 'keio_hachioji'],
  ['17:13', 'kakutei', 'takaosanguchi'],
  ['17:20', 'keio_liner', 'hashimoto'],
  ['17:21', 'tokkyu', 'keio_hachioji'],
  ['17:22', 'kakutei', 'takaosanguchi'],
  ['17:28', 'tokkyu', 'hashimoto'],
  ['17:32', 'tokkyu', 'keio_hachioji'],
  ['17:33', 'kakutei', 'takaosanguchi'],
  ['17:40', 'keio_liner', 'hashimoto'],
  ['17:41', 'tokkyu', 'keio_hachioji'],
  ['17:42', 'kakutei', 'takaosanguchi'],
  ['17:49', 'tokkyu', 'hashimoto'],
  ['17:51', 'tokkyu', 'keio_hachioji'],
  ['17:52', 'kakutei', 'takaosanguchi'],

  ['18:00', 'keio_liner', 'keio_hachioji'],
  ['18:01', 'tokkyu', 'keio_hachioji'],
  ['18:02', 'kakutei', 'takaosanguchi'],
  ['18:09', 'tokkyu', 'hashimoto'],
  ['18:10', 'tokkyu', 'keio_hachioji'],
  ['18:12', 'kakutei', 'takaosanguchi'],
  ['18:20', 'keio_liner', 'hashimoto'],
  ['18:21', 'tokkyu', 'keio_hachioji'],
  ['18:22', 'kakutei', 'takaosanguchi'],
  ['18:29', 'tokkyu', 'hashimoto'],
  ['18:32', 'tokkyu', 'keio_hachioji'],
  ['18:33', 'kakutei', 'keio_tama_center'],
  ['18:40', 'keio_liner', 'hashimoto'],
  ['18:41', 'tokkyu', 'keio_hachioji'],
  ['18:42', 'kakutei', 'takaosanguchi'],
  ['18:49', 'tokkyu', 'hashimoto'],
  ['18:52', 'tokkyu', 'keio_hachioji'],
  ['18:53', 'kakutei', 'keio_tama_center'],

  ['19:00', 'keio_liner', 'keio_hachioji'],
  ['19:01', 'tokkyu', 'keio_hachioji'],
  ['19:02', 'kakutei', 'takaosanguchi'],
  ['19:09', 'tokkyu', 'hashimoto'],
  ['19:12', 'tokkyu', 'keio_hachioji'],
  ['19:13', 'kakutei', 'takaosanguchi'],
  ['19:20', 'keio_liner', 'hashimoto'],
  ['19:21', 'tokkyu', 'keio_hachioji'],
  ['19:22', 'kakutei', 'takaosanguchi'],
  ['19:29', 'tokkyu', 'hashimoto'],
  ['19:32', 'tokkyu', 'keio_hachioji'],
  ['19:33', 'kakutei', 'hashimoto'],
  ['19:40', 'keio_liner', 'hashimoto'],
  ['19:41', 'tokkyu', 'keio_hachioji'],
  ['19:42', 'kakutei', 'takaosanguchi'],
  ['19:49', 'tokkyu', 'hashimoto'],
  ['19:52', 'tokkyu', 'keio_hachioji'],
  ['19:53', 'kakutei', 'takaosanguchi'],

  ['20:00', 'keio_liner', 'keio_hachioji'],
  ['20:01', 'tokkyu', 'keio_hachioji'],
  ['20:02', 'kakutei', 'takaosanguchi'],
  ['20:08', 'kyuko', 'keio_hachioji'],
  ['20:09', 'tokkyu', 'hashimoto'],
  ['20:13', 'kakutei', 'takaosanguchi'],
  ['20:20', 'keio_liner', 'hashimoto'],
  ['20:21', 'tokkyu', 'keio_hachioji'],
  ['20:22', 'kakutei', 'takaosanguchi'],
  ['20:28', 'kyuko', 'keio_hachioji'],
  ['20:29', 'tokkyu', 'hashimoto'],
  ['20:33', 'kakutei', 'takahatafudo'],
  ['20:40', 'keio_liner', 'hashimoto'],
  ['20:41', 'tokkyu', 'keio_hachioji'],
  ['20:42', 'kakutei', 'takahatafudo'],
  ['20:48', 'kyuko', 'keio_hachioji'],
  ['20:49', 'tokkyu', 'hashimoto'],
  ['20:53', 'kakutei', 'takahatafudo'],

  ['21:00', 'keio_liner', 'keio_hachioji'],
  ['21:01', 'tokkyu', 'keio_hachioji'],
  ['21:02', 'kakutei', 'takahatafudo'],
  ['21:08', 'kyuko', 'keio_hachioji'],
  ['21:09', 'tokkyu', 'hashimoto'],
  ['21:13', 'kakutei', 'takahatafudo'],
  ['21:20', 'keio_liner', 'hashimoto'],
  ['21:21', 'tokkyu', 'keio_hachioji'],
  ['21:22', 'kakutei', 'takahatafudo'],
  ['21:29', 'kukan_kyuko', 'keio_tama_center'],
  ['21:32', 'tokkyu', 'keio_hachioji'],
  ['21:33', 'kakutei', 'takahatafudo'],
  ['21:40', 'keio_liner', 'hashimoto'],
  ['21:41', 'kakutei', 'takahatafudo'],
  ['21:45', 'kyuko', 'keio_hachioji'],
  ['21:49', 'tokkyu', 'hashimoto'],
  ['21:52', 'kakutei', 'takahatafudo'],

  ['22:00', 'keio_liner', 'keio_hachioji'],
  ['22:01', 'tokkyu', 'keio_hachioji'],
  ['22:05', 'kakutei', 'takahatafudo'],
  ['22:13', 'tokkyu', 'keio_hachioji'],
  ['22:15', 'kakutei', 'keio_hachioji'],
  ['22:20', 'keio_liner', 'hashimoto'],
  ['22:23', 'tokkyu', 'keio_hachioji'],
  ['22:24', 'kakutei', 'takahatafudo'],
  ['22:30', 'keio_liner', 'takaosanguchi'],
  ['22:31', 'kukan_kyuko', 'hashimoto'],
  ['22:38', 'kakutei', 'takahatafudo'],
  ['22:41', 'kukan_kyuko', 'hashimoto'],
  ['22:45', 'tokkyu', 'takaosanguchi'],
  ['22:50', 'kukan_kyuko', 'hashimoto'],
  ['22:54', 'kakutei', 'hashimoto'],

  ['23:00', 'keio_liner', 'keio_hachioji'],
  ['23:01', 'tokkyu', 'keio_hachioji'],
  ['23:05', 'kakutei', 'takahatafudo'],
  ['23:10', 'kukan_kyuko', 'keio_tama_center'],
  ['23:16', 'tokkyu', 'keio_hachioji'],
  ['23:20', 'keio_liner', 'hashimoto'],
  ['23:21', 'kakutei', 'takahatafudo'],
  ['23:30', 'tokkyu', 'keio_hachioji'],
  ['23:32', 'kakutei', 'takahatafudo'],
  ['23:34', 'kaisoku', 'hashimoto'],
  ['23:45', 'tokkyu', 'keio_hachioji'],
  ['23:48', 'kakutei', 'takahatafudo'],
  ['23:53', 'kaisoku', 'hashimoto'],

  ['00:01', 'tokkyu', 'keio_hachioji'],
  ['00:05', 'kakutei', 'takahatafudo'],
  ['00:11', 'kaisoku', 'keio_tama_center'],
  ['00:14', 'kakutei', 'sakurajosui'],
  ['00:18', 'tokkyu', 'keio_hachioji'],
);

const TIMETABLE_DATA = {
  updatedAt: '2026年8月16日時点(ユーザー提供の平日下り時刻表をもとに書き起こし)',
  durationMin: DURATION_MIN,
  typeLabel: TYPE_LABEL,
  typeRank: TYPE_RANK,
  destLabel: DEST_LABEL,
  notReachingKarasuyama: NOT_REACHING_KARASUYAMA,
  notStoppingTypes: NOT_STOPPING_TYPES,
  weekday: WEEKDAY_RAW,
  // 土休日ダイヤは未取得。取得でき次第ここに同形式で追加する。
  holiday: null,
};
