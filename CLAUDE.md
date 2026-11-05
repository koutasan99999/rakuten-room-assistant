# 眼科医くま（楽天ROOM・Instagram）アプリ：開発の決まり

社長（オーナー）はプログラミング初心者。日本語で、平易に、事実だけを報告する。
最終目標は月3万円以上の安定した収益（楽天アフィリエイト）。フォロワー数・投稿数は中間指標。

## 構成
- 静的な画面（index.html・js/・css/）＋ Vercel の1つの関数（api/[route].js が server/*.js に振り分け。Hobby は関数12個まで）。
- 外部API：楽天市場の商品検索（1秒1回）、OpenAI（lib/ai.js の runWithModels）、Instagram 公式API（lib/ig-graph.js。トークン未設定）。
- 保存：会社のデータはすべて社長のiPhoneの localStorage（サーバーには保存場所がない）。主なキー：
  room-pitch（プレゼン・採用）／room-explore（広げる）／room-delivery（投稿セット）／room-texts（ROOM紹介文）／room-company（経営会議・業務）／room-ai-usage（AIの利用量と予算）。
  既存のデータを消す・初期化する変更はしない。キーを変えるときは読み替え（互換）を入れる。
- 定時実行：vercel.json の cron（Hobby は1日1回）。サーバーに会社のデータがないため、会議や制作は「アプリを開いたとき」に動く。

## 主な機能の場所
- 社長、これどうすか？（プレゼン・広げる・採用済み・投稿セット）：js/pitch.js・js/explore.js・js/delivery.js、lib/pitch.js・lib/pitch-genres.js・lib/expand.js・lib/postset.js
- 経営報告（ダッシュボード・会議・提言・業務）：js/company.js・lib/company.js（事実はコードが集め、AIは番号で根拠を示すだけ）
- AIの費用：js/app.js の AiUsage（呼ぶ前に予算を確認。推定1回0.5円）

## 守ること（社長の方針）
- 確認できない情報は作らない（価格・在庫・ランキング・レビュー・効果）。分からないものは「未確認」「未取得」と表示する。
- 実行していないことを実行したと書かない（投稿・コメント・ROOM登録）。社長の申告と自動確認を区別する。
- 楽天ROOMへの投稿は自動化しない（ROOMは機械的な投稿を禁止）。紹介文のコピーとROOMを開くまで。
- Instagramのコメント・いいね・フォローの自動化、非公式な自動操作はしない。
- 有料サービス・有料APIを、社長の承認なしに導入・課金しない。秘密の鍵は Vercel の環境変数だけに置く（コード・画面・会話に書かない）。
- 体験したような表現（使ってみた・愛用）、誇張・断定、医療の効果は書かない。PR（アフィリエイト）表記を入れる。

## 作業の流れ
- テスト：`npm test`（node:test）。画面の確認：`PORT=3143 MOCK=1 node scripts/dev-server.js` を起動し、Playwright（iPhone 13 の画面サイズ）で操作する。
- 画面のファイルを変えたら、index.html と js/app.js の版（?v=）をそろえて上げる（test/ で確認している）。
- 小さく変えてテスト → ブランチ → PR → Vercel のデプロイが success を確認 → squash で取り込む。
- 報告は「実際に完了したこと／確認できたこと（テスト用データか本番か）／未確認・未実装と理由／社長が本当にすること」を分けて書く。
