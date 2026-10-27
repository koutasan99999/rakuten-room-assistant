# ROOM商品発掘（rakuten-room-assistant）

楽天市場から楽天ROOM向きの商品をランダムに探し、AI（OpenAI）が最大5件を選んで、ROOM用の紹介文まで用意するスマホ向けWebアプリです。

使い方：アプリを開く →「商品を発掘する」→ 気になる商品の「楽天で商品を見る」→「紹介文をコピー」→ 楽天ROOMに投稿

## なぜGitHub PagesではなくVercelなのか

GitHub Pagesは「見た目のファイルを置くだけ」の場所なので、APIキーを置くと誰でも見られてしまいます。
Vercel（無料プラン）なら、APIキーをサーバー側の「環境変数」に隠したまま楽天・OpenAIを呼び出せます。
画面もAPIもこのリポジトリ1つから自動で公開されるので、GitHubに変更を入れるだけで更新されます。

## 構成

| 場所 | 役割 |
| --- | --- |
| `index.html` / `css/` / `js/` | スマホ画面 |
| `api/discover.js` | 「商品を発掘する」の処理（Vercel上で動く） |
| `lib/rakuten.js` | 楽天市場 商品検索API（2026-07-01版、ページランダム化・除外・重複除去） |
| `lib/ai.js` | OpenAIでの商品選定と紹介文生成（NG表現の除去、失敗時の予備表示） |
| `lib/genres.js` | ジャンルと検索キーワード |
| `test/` | 自動テスト（`npm test`） |

## Vercelに登録する環境変数

| 名前 | 内容 |
| --- | --- |
| `RAKUTEN_APP_ID` | 楽天ウェブサービスのアプリID（applicationId） |
| `RAKUTEN_ACCESS_KEY` | 楽天ウェブサービスのアクセスキー（accessKey） |
| `OPENAI_API_KEY` | OpenAIのAPIキー |
| `APP_PASSCODE` | 合言葉（他人に使われてAPI料金がかからないようにするため） |
| `OPENAI_MODEL`（任意） | 使うモデルを変えたいとき。未設定なら低コストモデルを自動で選びます |
| `RAKUTEN_AFFILIATE_ID`（任意） | 楽天アフィリエイトID |
| `RAKUTEN_REFERER`（任意） | 楽天に送るReferer。未設定ならアプリのURLを自動で使います |

楽天ウェブサービスの管理画面で、アプリの「許可されたWebサイト」にVercelのURL（例：`xxxx.vercel.app`）を登録してください。

## 料金を抑える工夫

- AIへは商品名・価格・レビュー・説明を短く切り詰めた情報だけを送ります
- 低コストモデル（nano / mini クラス）を使い、1回の発掘につきAI呼び出しは原則1回です
- 合言葉で自分以外が使えないようにしています

## 開発者向け

```
npm test                 # 自動テスト
MOCK=1 npm run dev       # APIキーなしで画面を確認（http://localhost:3000）
```
