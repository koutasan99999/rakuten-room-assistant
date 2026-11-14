# 眼科医くま（楽天ROOM・Instagram）アプリ：開発の決まり

社長（オーナー）はプログラミング初心者。日本語で、平易に、事実だけを報告する。
最終目標は月3万円以上の安定した収益（楽天アフィリエイト）。フォロワー数・投稿数は中間指標。

## 作業の始めと終わり（必ず）
- 作業を始めるときは、PROJECT_STATUS.md（現行・廃止・予定の一覧）と実際のコードを両方読んでから始める。食い違いがあればコードが正。PROJECT_STATUS.md を直す。
- 機能を追加・変更・削除したら、同じコミットで PROJECT_STATUS.md も直す。
- 「商品ドロボー」は廃止済み。残っているコードやデータを勝手に復活させない（一部は広報・プレゼンが使っているので、消すときも社長に確認する）。

## 構成
- 静的な画面（index.html・js/・css/）＋ Vercel の1つの関数（api/[route].js が server/*.js に振り分け。Hobby は関数12個まで）。
- 外部API：楽天市場の商品検索（1秒1回）、OpenAI（lib/ai.js の runWithModels）、Instagram 公式API（lib/ig-graph.js。トークン未設定）。
- 保存：会社のデータはすべて社長のiPhoneの localStorage（サーバーには保存場所がない）。主なキー：
  room-pitch（プレゼン・採用）／room-explore（広げる）／room-delivery（投稿セット）／room-texts（ROOM紹介文）／room-company（経営会議・業務）／room-agents（AI社員の試験：バイヤーAI×監査AIの実行記録）／room-ig-perf（投稿ごとの実績：公式APIか手入力。未取得は推測しない）／IndexedDB room-creative（投稿画像の版と客観確認の結果）／room-ai-usage（AIの利用量と予算。実測の使用量と実行の記録も）／room-pr（Instagram広報部：フォロー候補・コメント候補）。
  既存のデータを消す・初期化する変更はしない。キーを変えるときは読み替え（互換）を入れる。
- 定時実行：vercel.json の cron（Hobby は1日1回）。自律運営（2026-11-15）：QStash（Upstash の無料枠・15分ごと・署名を lib/qstash.js で確認。2026-11-16 に GitHub の定期実行から移した。GitHub Actions は手動の実行だけ）が /api/worker を呼び、サーバーの保存場所（Upstash Redis の無料枠・lib/kv.js）に仕事の途中経過と成果物を残す（lib/worker.js）。保存場所が未接続なら、会議や制作は「アプリを開いたとき」だけ動く。AIの費用の上限はサーバー側でも守る（lib/budget.js）。制作ライン（2026-11-16・lib/production.js）：監査AIが合格にした候補を、社長の確認なしで 企画担当AI→投稿セット制作AI→監査AI→制作担当AI へ渡し、合格した投稿セットだけを社長の確認待ちにする。社員は仕事探し（worker:board）で自分の仕事を見つける。制作が止まっていても、営業候補調査（0円）と経営企画AI（lib/research.js・3日に1回・公式ページの引用をコードが照合）は独立して進む。QStashの停止は40分で検知して画面に出す。出勤状況は「今日AIを呼んで仕事をした社員」だけ、社長確認待ちは別欄（js/work.js）。

## 主な機能の場所
- 社長、これどうすか？（プレゼン・広げる・採用済み・投稿セット）：js/pitch.js・js/explore.js・js/delivery.js、lib/pitch.js・lib/pitch-genres.js・lib/expand.js・lib/postset.js
- 経営報告（ダッシュボード・会議・提言・業務）：js/company.js・lib/company.js（事実はコードが集め、AIは番号で根拠を示すだけ）
- AIの費用：js/app.js の AiUsage（呼ぶ前に予算を確認。推定1回0.5円）
- AI社員の仕事（経営報告のいちばん上）：js/work.js（実際の記録だけで表示）。営業・交流担当AI：lib/outreach.js・server/pr.js（outreach_draft／outreach_audit）
- Instagram広報部（#pr）：js/pr.js・js/pr-store.js・server/pr.js・lib/ig-discovery.js。自動発掘：(1) 公式サイトのHTMLがリンクしているInstagramを候補に（費用0円・推測しない）(2) Facebookログイン方式の公式API（IG_FB_ACCESS_TOKEN・IG_FB_USER_ID）で、ビジネス／クリエイターの直近の投稿を集めてコメント案まで（未設定なら動かない）(3) ハッシュタグ検索は Meta の審査後に IG_HASHTAG_SEARCH=on。今の「Instagramログイン」方式の公式APIでは、ハッシュタグ検索・他のアカウントの調査・第三者へのフォロー/コメントはできない。自動化は探す場所の用意・分類・優先度・重複防止・コメント案・履歴まで

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
