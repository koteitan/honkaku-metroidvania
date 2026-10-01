# 沈鐘のリフレイン (SUNKEN BELL REFRAIN)

地の底に沈んだ巨大な鐘の内側の街を舞台にした、ブラウザで遊べるメトロイドヴァニアです。
小さな調律人形リオを操作して、5 本の音叉を取り戻し、百年鳴らない鐘をどうするかを決めます。

**遊ぶ**: https://koteitan.github.io/honkaku-metroidvania/

## 操作

| キー | 動作 |
|---|---|
| ← → | 移動 |
| ↑ | 話す・調べる・祠を鳴らす (↑+X で上攻撃) |
| Z / Space | ジャンプ (空中でもう一度: 二段ジャンプ / 落下中に押し直して長押し: 滑空) |
| X | 打鍵 (攻撃)。空中で ↓+X: フォルテ |
| C / Shift | スタッカート (ダッシュ) |
| V | 共鳴弾 |
| ↓ 長押し | 調律 (響きを使って体力を回復) |
| Tab / M | 地図 |
| Esc | ポーズ |

ゲームパッドにも対応しています。セーブは鐘の祠で自動的にブラウザに保存されます。

## 文書

- [story.md](story.md) — 物語 (世界の成り立ち、人物、地域、本編、ゲーム内テキスト)
- [design.md](design.md) — おもしろさをどこに持ってくるか (操作の手触り、能力、戦闘、ボス、探索)
- [level.md](level.md) — レベルデザイン (数値の基準、世界地図、全部屋の一覧、進行の検証)
- [docs/bible.md](docs/bible.md) — 3 つの文書の共通設定
- [docs/rooms-format.md](docs/rooms-format.md) — 部屋データの書式

## 技術

- HTML5 Canvas + 素の JavaScript (ES modules)。ビルド不要、外部ライブラリなし。
- 画像ファイルなし: ドット絵はすべてコードで描いています。音は WebAudio で合成しています。
- `node tools/validate.mjs` で部屋データの形と、能力ごとの到達可能性・閉じ込め (ソフトロック) を検査できます。
- `python3 tools/extract_text.py` で story.md のゲーム内テキストを `js/text_data.js` に書き出します。
- デバッグ: `index.html?room=GW_01&ab=dash,double` で部屋と能力を指定して始められます。
