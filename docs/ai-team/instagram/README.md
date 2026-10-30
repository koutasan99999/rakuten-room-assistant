# Instagram（@ganka_kuma_）をAI社員が確認・分析するための環境

最優先課題（社長の指示 2026-10-30）：Instagramの新規読者の獲得。商品発掘・投稿制作の改善より優先する。
最初は「閲覧と分析だけ」。投稿・フォロー・いいね・コメント・DMなどの操作は、AI社員は一切しない。

## 調査結果（2026-10-30・CEO補佐）

### 1. iPhoneのクラウド版 Claude Code から、公開プロフィール・投稿を直接見られるか
- **見られなかった。**
  - www.instagram.com・i.instagram.com・graph.facebook.com は、このクラウド環境のネットワーク設定で遮断されている（curl は 403、WebFetch は名前解決できず）。
- ネットワーク設定で instagram.com を許可すれば、ページの取得までは試せる。ただし次の理由で、おすすめしない。
  - Instagramの公開ページは、ログインしていないと中身がほとんど出ない（ログイン画面になる）ことが多い。何が取れるかは未確認。
  - インサイト（リーチ・保存・シェア）は、ログインしないと見られない。
  - 自動でページを集める行為は、Instagramの利用規約で禁止されている自動収集にあたるおそれがある。

### 2. Mac の Claude in Chrome で、ログイン済みのプロフィール・投稿・インサイトを見られるか
- **できる見込み。** ただし、このセッションからは試せていない。
- Claude in Chrome は、Chrome（またはEdge）の拡張機能。ログイン済みのChromeの画面を読める（Anthropicの公式ヘルプ・ドキュメント）。
- Instagramのプロフィールと投稿は、ログイン済みのChromeで読めるはず。
- Web版のInstagramでインサイトがどこまで見られるかは未確認。
  - 投稿ごとの「インサイトを見る」やプロフェッショナルダッシュボードが、Web版にどこまであるか分からない。
  - Web版で足りないときは、iPhoneのInstagramアプリのインサイト画面のスクリーンショットで補う。
- 今はこのセッションと社長のMacはつながっていない（接続されているコンピューターは0台）。

### 3. 取得した情報を、AI社員が続けて使う方法
- 見た情報は `docs/ai-team/instagram/snapshots/日付.md` に、「実際に見えた数字」と「見えなかったもの」を分けて保存する（ひな形：snapshots/TEMPLATE.md）。
- マーケティング責任者・競合調査担当・分析担当（analytics-lead）は、このフォルダを読んで分析する。スナップショットにない数字は使わない。
- 日付ごとにファイルを分けるので、前回との差（伸びたか）を見られる。

### 4. 公式APIでインサイトを取れるか（将来）
- **取れる見込み。費用は無料。** ただし、条件や上限は出典によって食い違う（Meta公式のページで確認が必要）。
- 使い方：Instagram API with Instagram Login（Instagramでログインする方式）
  - 必要なもの：プロアカウント（ビジネスかクリエイター）、Meta for Developers のアプリ（無料）、アクセストークン、インサイト用の権限（instagram_business_manage_insights など）
  - Facebookページとの連携は要らない、とする資料がある。
- インサイトへの対応：Meta公式の古い概要ページには「インサイトは非対応」とあり、別の公式ページには「対応」とある。食い違っているので未確認。
- アプリ審査：自分のアカウントだけで使う（開発モードで、アプリの役割を持つ人だけが使う）なら審査なしで使える、とする資料があるが未確認。
- 呼び出しの上限：「1時間に200回」とする資料と、別の計算式を書く資料がある。未確認。
- 費用：API自体は無料（Metaの公式ページでの確認は未済）。アプリへの組み込みは、Vercelの無料枠の範囲で動く見込み。
- 承認が必要になる点：
  - Meta開発者アカウントの登録と、アクセストークンの発行は社長の操作。
  - トークンをサーバーに保存する（Vercelの環境変数）。
  - このクラウド環境で使う場合は、graph.instagram.com をネットワーク設定で許可する。

### 出典
- Instagram API の概要（Meta公式・新旧で記載が食い違う）：
  - https://developers.secure.facebook.com/docs/instagram/platform/instagram-api/overview
  - https://developers.secure.facebook.com/docs/instagram/instagram-only-api/overview
- メディアのインサイト（Meta公式）：https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights
- 2026年の開発者向けガイド（第三者）：https://www.getphyllo.com/post/instagram-api-guide 、https://zernio.com/blog/instagram-graph-api
- Claude in Chrome（Anthropic公式）：
  - https://support.claude.com/en/articles/12012173-getting-started-with-claude-for-chrome
  - https://support.claude.com/en/articles/12902428-use-claude-in-chrome-safely
  - https://code.claude.com/docs/en/chrome

## いちばん簡単な接続方法（提案）：Mac の Claude in Chrome で「見るだけ」の観察メモを作る
→ 手順は `docs/ai-team/instagram/connect-chrome.md`
