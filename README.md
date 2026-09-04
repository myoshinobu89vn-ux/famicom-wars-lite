# ファミコンウォーズライク (MVP)

iPhoneのSafariでアプリっぽく遊べる、最小構成のファミコンウォーズ風ストラテジーゲーム。ビルド不要のVanilla HTML/CSS/JS。

## 遊び方

1. 自分のユニット(青)をタップして選択 → 移動可能範囲(青ハイライト)が表示される
2. 移動先タップで移動。隣接する敵(赤ハイライト)がいれば攻撃、いなければ「待機」
3. 所有する首都・工場(旗アイコン付きの黄/茶タイル)をタップしてユニットを生産
4. 「ターン終了」でCPUのターンへ。敵の首都を占領すれば勝利、自分の首都を奪われると敗北

## ユニット

| ユニット | コスト | HP | 移動力 | 攻撃力 | 占領 |
|---|---|---|---|---|---|
| 兵士 | 100G | 10 | 3 | 4 | 可 |
| 戦車 | 300G | 10 | 5 | 6 | 不可 |

## 地形

平地・森(戦車は移動コスト2)・水(進入不可)・都市/工場/首都(占領可・収入100G/turn、工場と首都は生産可)。

## ローカルでの動作確認

```
python -m http.server 8000
```

その後 `http://localhost:8000/` をブラウザで開く。

## デプロイ (GitHub Pages)

`main`ブランチにpush後、リポジトリの Settings → Pages で `Deploy from branch: main / (root)` を選択。発行されたURLをiPhoneのSafariで開き、共有ボタンから「ホーム画面に追加」するとアプリのように起動できる。

## おまけ: タイプ相性クイズ

`pokemon-type-quiz/` に、ポケモンGOのタイプ相性を学べる3択クイズアプリを同梱している。詳細は [pokemon-type-quiz/README.md](pokemon-type-quiz/README.md) を参照。

## おまけ: 千歳烏山→新宿 次発電車比較

`chitose-karasuyama-shinjuku/` に、京王線 千歳烏山駅から新宿方面への次発電車を比較できるツールを同梱している。詳細は [chitose-karasuyama-shinjuku/README.md](chitose-karasuyama-shinjuku/README.md) を参照。
