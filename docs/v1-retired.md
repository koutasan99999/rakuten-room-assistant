# サングラスくま株式会社1.0の運用終了（2026-11-17 社長の決定）

1.0の定期実行・AI社員の自律運営・1.0だけが使うAPIを止めた。データ・記録・コード・開発履歴は消していない。

## 止めたもの
- QStash（15分ごと）の「1.0の番」：すべて2.0だけを動かす（server/worker.js。交互の番 v2:alt も使わない）
- Vercelの定期実行（vercel.json の crons）：/api/worker（1.0の1日1回）と /api/ig（1.0の予定の自動投稿）を外した
- GitHub Actions の手動の実行（worker.yml）：target=v1 を選んでも2.0が動く（既定を v2 に変更）
- 1.0だけが使うAPI 26種類（lib/v1-retired.js の V1_ONLY_ROUTES）：AI・楽天・Googleを呼ぶ前に 410「運用を終了しました」と返す（api/[route].js）
- 1.0の画面：入口（/）は運用終了の案内。1.0の画面は閲覧用として /v1/ に残した（AIを使うボタンは410で止まる）
- 1.0の途中の仕事（worker:job）：データは消さず、画面には「仕事中・途中」と出さない（/api/worker の state に stoppedJob として残る）

## 止めていないもの（2.0が使う）
- QStash の定期実行そのもの（/api/worker → 2.0）
- API：v2・worker・image（商品画像の取り込み）・media（表紙画像）・data（1.0の記録の読み書き）・kuma-master・ig（AIを使わない。定期実行は外した）
- 共通の部品：js/ig-render.js・ig-covers.js・ig-multi.js・carousel-layout.js（2.0の投稿画像）、lib/ の楽天・AI・予算・制作・表紙画像の部品

## 保存しているデータ（消していない）
- Upstash（サーバーの保存場所）の 1.0 のキー：worker:*（途中の仕事・成果物・記録・候補の在庫）、store（投稿セット・社長の判断の正本）、budget:*（費用の記録）
- 社長のiPhoneのブラウザの localStorage（room-*）：/v1/ を開くと同じ記録が見られる。「社長の対応」タブからバックアップ（JSON）を書き出せる
- GitHub のリポジトリとコミット履歴、docs/ の開発資料
- 秘密の鍵は複製していない（Vercelの環境変数のまま）

## 元に戻すとき
- Vercel の環境変数 V1_ENABLED=1 を入れると、1.0のAPIと1.0の定期実行（QStashの交互）が今までどおり動く（コードを戻さなくてよい）
- Vercel の1日1回の定期実行は、vercel.json の crons を戻す
- テストは `V1_ENABLED=1` で1.0の機能も確かめている（npm test）。運用終了の動きは test/v1-retired.test.js
