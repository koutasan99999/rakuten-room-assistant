# Linear → Claude Code → PR の自動連携（KOT-6・2026-11-19）

社長が ChatGPT（かみさま）に開発を頼む → ChatGPT が Linear にチケットを作る → GitHub Actions が見つけて Claude Code を動かす → 作業ブランチで実装・npm test → PR。
GitHub の Issue を書いたり、Mac の Claude Code に貼り付けたりしなくてよい。PR は自動ではマージしない。

## 仕組み

- ワークフロー：`.github/workflows/linear-claude.yml`（道具は `scripts/linear-claude/`）
- 起動：5分ごと。主は QStash（Upstash の無料枠）が `/api/linear-kick` を呼び、GitHub Actions を workflow_dispatch で起動する（2026-11-20）。GitHub の schedule（5分ごと）は予備
  - 理由：GitHub の schedule は遅れたり飛ばされたりする。11/20 は 09:01 に取り込んでから 19:43 までに、定期実行は 15:57 の1回だけだった（16:06 に作られた KOT-9 が受け付けられなかった）
  - 二重起動の防止：`/api/linear-kick` は、実行中・待ちの実行があるとき、直近4分以内に実行があったとき（schedule を含む）、同じ呼び出しの再送のときは起動しない。schedule の実行も、直前4分以内に別の実行があれば何もしない。concurrency で同時に動くのは1つだけ。チケットの二重処理はラベルで防ぐ（下）
  - 急ぐときは Actions の「Linear → Claude Code」→ Run workflow（チケット番号も指定できる）
- 1回の実行で1件だけ処理する（いちばん古いもの）。同時に動くのは1つだけ（concurrency: linear-claude）
- 流れ：
  1. Linear から承認済みのチケットを探す（下の条件）
  2. 「Claude処理中」ラベルを付け、状態を In Progress にし、受付のコメントを書く
  3. main から作業ブランチ `linear/kot-番号-実行番号` を作る
  4. Claude Code（CLI・CLAUDE_CODE_OAUTH_TOKEN）が実装する。使えるのはファイルの読み書きと npm test などだけ（push・commit・外部のサイト・gh は使えない）
  5. ワークフローが変更を確かめ（.github/ と .env の変更は断る）、npm test をもう一度実行し、commit・push・PR作成
  6. Linear に結果を書く：成功＝「Claude完了」・In Review・PRのリンクとテストの件数／失敗＝「Claude失敗」と理由（npm test が失敗したPRは下書きにする）

## 処理するチケットの条件（承認）

すべて満たすものだけ（`scripts/linear-claude/lib.mjs` の eligibility）：

- チーム KOT（Kotaro AI Development）
- ラベル「Claude開発依頼」が付いている ← **これが承認の印**
- 作成者が許可リストにある（既定は社長のアカウント。ChatGPT の Linear 連携も社長のアカウントで書く。変えるときはリポジトリの Variables に `LINEAR_ALLOWED_CREATOR_IDS`）
- 状態が完了・取消・重複でない
- 「Claude処理中」「Claude完了」「Claude失敗」が付いていない
- 同じチケットのPRが開いていない
- タイトル200文字・本文12000文字まで（超えたら切り詰めずに断る）

## 二重実行・無限ループを防ぐ

- 受付の最初に「Claude処理中」を付け、付いたことを読み直して確かめてから作業する。付いているチケットは次の実行で選ばれない
- 終わったら「Claude完了」か「Claude失敗」に付け替える。どちらかが付いていれば、何度実行しても選ばれない
- 失敗をやり直したいとき：直したうえで「Claude失敗」ラベルを外す（人が外すまで再実行しない＝失敗の繰り返しなし）
- 途中で止まって「Claude処理中」が残ったとき（まれ）：実行の記録を確かめてから、手で外す
- Actions が作る PR・Linear への書き込みは、ほかのワークフローを起動しない。PR・コメントの「@」は全角にして、claude.yml（@claude）が反応しないようにしている

## 暴走の防止（上限）

- 1回の実行で1件だけ。同時に動くのは1つだけ。Claude は1件あたり最大80回のやりとり・40分まで（ジョブ全体は50分）
- 自動連携が作ったPRが、確認待ちで **5件** 開いていたら、新しいチケットを受け付けない（PRを確認・クローズすると再開）
- 直近24時間に作ったPRが **10件** に達したら、時間がたつまで受け付けない
- 上限に当たったときは、チケットに印を付けずに待つ（失敗にしない）。値は Variables の LINEAR_CLAUDE_MAX_OPEN_PRS・LINEAR_CLAUDE_MAX_PER_DAY で変えられる
- Claude は定額プランのトークンで動く（API の従量課金キー ANTHROPIC_API_KEY は使わない）ので、使った分の請求は発生しない。上限は利用枠の使い切りと、確認しきれないPRの山を防ぐため

## 止まる条件（失敗のとき）

- 失敗したチケットは「Claude失敗」になり、人がラベルを外すまで二度と実行しない（自動の再試行なし）
- Linear や GitHub に接続できないときは、何も受け付けずにその回を終える（次の5分後にまた確かめるだけ。Claude は動かない）
- 止めたいとき：Actions の「Linear → Claude Code」→ … → Disable workflow。または Secrets の LINEAR_API_KEY を消す（何もしなくなる）

## 安全

- 秘密の値は GitHub の Secrets にだけ置く：`LINEAR_API_KEY`（Linear の個人のAPIキー）・`CLAUDE_CODE_OAUTH_TOKEN`（既存）
- Claude Code の段階には `CLAUDE_CODE_OAUTH_TOKEN` だけを渡す。Linear の鍵と GitHub の書き込みの鍵は渡さない（checkout も鍵を残さない設定）
- 起動したときの版の道具を作業場所の外にコピーして使う（Claude が道具を書き換えても、その実行には効かない）
- チケットの本文は「データ」として囲み、安全の決まり（秘密を出さない・決まりを無視しない・.github/ を変えない・外部に投稿しない）を先に書く
- 既存の claude.yml（Issue の @claude）と、その「bot・GitHub App からの依頼は受けない」設定は変えていない
- しないこと：main への直接の push・マージ・本番へのデプロイ・Instagram や楽天ROOMへの投稿

## ChatGPT（かみさま）への頼み方

ChatGPT に、次のように伝えておく（カスタム指示やメモリに入れておくと毎回書かなくてよい）：

> 開発を頼んだら、Linear のチーム「Kotaro AI Development」（KOT）にチケットを作り、ラベル「Claude開発依頼」を付けてください。タイトルは短く、本文に目的・やること・完了の条件を書いてください（12000文字まで）。

## 社長が一度だけ行う設定

1. Linear の個人のAPIキーを作る：Linear → Settings → Account → Security & access → Personal API keys → New API key
   - 名前：`github-actions-claude`
   - 権限：Read と Write（Admin は不要）・チームは Kotaro AI Development だけ
2. GitHub に登録する：リポジトリの Settings → Secrets and variables → Actions → New repository secret
   - Name：`LINEAR_API_KEY`　Secret：1. のキー
3. （確認）Settings → Actions → General → Workflow permissions の「Allow GitHub Actions to create and approve pull requests」がオン（PR #151 で動いているので、すでにオン）

鍵が未登録のあいだは、定期実行は何もせずに終わる（失敗にしない）。

## 費用

- GitHub Actions：公開リポジトリなので無料。チケットが無いときの1回は十数秒
- Claude：定額プランのトークン（CLAUDE_CODE_OAUTH_TOKEN）。API の従量課金は使わない
- Linear API：5分に1回の確認で数回呼ぶだけ（上限に十分な余裕がある）

## 注意

- GitHub の定期実行は混んでいると遅れる（数分〜数十分）。11/13 に worker.yml の定期実行が長い時間起動しなかったことがある。遅れが続くときは、Actions の Run workflow で手動でも動かせる
- 公開リポジトリの定期実行は、60日間リポジトリに動きが無いと GitHub が止める（Actions の画面から再開できる）
- 定期実行は main にあるファイルだけが動く。このPRを取り込むまでは、`linear-claude-e2e` ブランチへの push で同じ処理を確かめる

## QStash による5分ごとの起動（2026-11-20・社長が一度だけ行う設定）

鍵（GH_DISPATCH_TOKEN）が未設定のあいだ、`/api/linear-kick` は何もしない（予備の GitHub の schedule だけで動く）。

1. GitHub の fine-grained token を作る：GitHub の右上のアイコン → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token
   - Repository access：Only select repositories → rakuten-room-assistant だけ
   - Permissions：Actions を Read and write（ほかは付けない。Metadata の読み取りは自動で付く）
   - 有効期限：任意（切れたら作り直す）
2. Vercel に登録する：プロジェクト → Settings → Environment Variables → `GH_DISPATCH_TOKEN`（Production）に 1. の値 → 保存後、Deployments から最新の本番を Redeploy
3. QStash の定期実行を作る：Upstash のコンソール → QStash → Schedules → Create Schedule
   - Destination：`https://rakuten-room-assistant-psi.vercel.app/api/linear-kick`
   - Cron：`*/5 * * * *`・Method：POST・本文なし・Retries：0（再送で無料枠を使わない）
   - 費用：無料枠（1日1,000件）の中。既存の /api/worker（15分ごと＝1日96件）と合わせて1日約384件
4. 確かめ方：Actions の「Linear → Claude Code」に、5分ごとに workflow_dispatch の実行が並ぶ（実行中・直前に実行があった回は起動しない）

