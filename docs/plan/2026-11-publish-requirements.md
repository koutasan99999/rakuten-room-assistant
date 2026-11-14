# Instagram公式APIでの公開：必要な条件と接続テストの準備（2026-11-14・段階2の下調べ）

表記：【事実】＝このリポジトリのコードで確認／【要確認】＝Metaの公式資料で確かめていない（この作業環境から developers.facebook.com を読めないため）

## 1. 認証
- 方式：Instagramログイン方式の公式API（graph.instagram.com・v23.0）【事実：lib/ig-graph.js】
- 必要な環境変数（Vercel の Production）【事実】
  - IG_ACCESS_TOKEN：投稿の権限つきの長期の鍵（約60日。lib/ig-graph.js の refreshToken で延長できる）
  - IG_PUBLISH_ENABLED=1：これが無いと投稿しない（安全装置）
  - IG_USER_ID：任意（無ければ me）
- 必要な権限：instagram_business_basic・instagram_business_content_publish【要確認】
- アカウント：プロ（ビジネスまたはクリエイター）アカウント【要確認】。自分のアカウントだけに投稿する（他人への投稿・コメント・フォローの機能は作らない）
- Metaのアプリの審査：自分（アプリの管理者）のアカウントに投稿するだけなら不要の可能性【要確認】

## 2. 画像
- 投稿の作り方：画像の公開URL（https）を渡して入れ物（container）を作り、公開（media_publish）する。カルーセルは2〜10枚【事実：lib/ig-graph.js の publish】
- 画像の形式：JPEG【要確認】。縦横比は 4:5〜1.91:1【要確認】。今の描画は 1080×1350（4:5）を想定【推測：js/ig-render.js の寸法は要確認】
- 画像の権利：楽天の商品画像をInstagramに使う条件は未確認【事実：画面で「このまま投稿しない」と警告】→ 段階2の標準は「商品写真なし」の版（noPhoto）

## 3. 画像の作成と置き場所（推奨案）
- 作成：今の描画（js/ig-render.js・ブラウザの canvas）をそのまま使う。社長が採用したときに、アプリが画像をJPEGにしてサーバーへ送る（サーバーで描く仕組みは作らない＝新しい部品が要らない）
- 置き場所（推奨）：Upstash Redis（今の無料枠）に画像を1枚ずつ保存し、/api/media?id=…（推測できない長いID）から配る。新しい契約は不要
  - 1枚の大きさ：JPEG で数百KBの見込み【推測】。Upstash の無料枠の容量は256MB【事実：PROJECT_STATUS】、1回の要求の上限は【要確認】
  - 投稿が済んだ画像は、投稿のURLを記録したあと保管期限で消す（元の投稿セットの文章・商品は消さない）
- 代わりの案：Vercel Blob（BLOB_READ_WRITE_TOKEN）。Hobby の無料の範囲は【要確認】→ 使うなら見積もりと承認が先

## 4. 接続テストの準備（段階1で用意したもの）
- /api/ig の action: readiness（読むだけ・投稿しない）【事実：server/ig.js】
  - 必要な設定があるか（名前だけ。値は出さない）、鍵があればアカウントの情報を読めるか、画像の仕組みの状態（未実装）を返す
- 段階2で足す接続テスト：入れ物（container）を作って状態が FINISHED になるかを確かめ、公開（media_publish）はしない【要確認：作っただけの入れ物は公開されず、24時間で消える】

## 5. 今足りないもの（2026-11-14）
1. 社長の設定：IG_ACCESS_TOKEN と IG_PUBLISH_ENABLED=1（Vercel の環境変数）。Metaの開発者の画面での作業が必要（無料）
2. コード（段階2）：承認した投稿セットの画像をJPEGにして保存する仕組み・/api/media・公開の順番待ち（1日1件まで）・投稿のURLの記録
