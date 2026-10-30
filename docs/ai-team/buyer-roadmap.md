# バイヤー発掘便：Web調査便をアプリの「発掘開始」から動かす（調査と設計案）— 2026-10-30

調査：競合調査担当（competitor-researcher）。根拠はWebSearchの検索結果（公式ページの抜粋を含む）。公式ページそのもの（platform.openai.com・developers.openai.com・brave.com）は、この環境では開けなかった。

## 結論
- **おすすめ：既存のOpenAIキーで、Responses API の web_search ツールを使う（新しいサービスの登録は不要）。**
  - 検索で実際に見つかった出典URLが、応答の中に返る。「検索で確認したURLだけを使う」という方針と合う。
  - 調べるサイト（ドメイン）を指定・除外でき、国も指定できる。
  - 費用は、1回（検索10回＋選定1回）で約15円＋未確認分。内訳は検索料 $0.10（約15円）、選定（gpt-5.4-nano）が約0.7円、検索で取ってきた内容のトークン代は量が未確認。
  - **費用が発生するので、社長の承認が必要。**
- 0円で始めたい場合の次点：Tavily の無料枠（月1,000回。クレジットカード不要）で検索し、選定は既存のOpenAIで行う。新しいサービスへの登録になるので、承認が必要。

## 使えない・おすすめしないもの
- Google Custom Search JSON API：新規受付が終了し、2027-01-01 に終了予定。
- Bing Search API：2025-08-11 に提供終了。
- Brave：2026年2月に無料プランを廃止（クレジットカード必須）。検索結果の保存にも制限がある。
- Gemini の検索グラウンディング：検索候補を必ず表示する決まりがあり、結果のキャッシュ・分析が禁止されている。
- 楽天のAPIだけでは、メーカー公式などの楽天以外の情報は取れない。

## 実行方法の設計案（実装は承認のあと）
1. 既存の検索ジョブ（`js/search-jobs.js`）に乗せる。テーマごとに1回ずつサーバーを呼ぶ（1回の中で web_search を1〜2回）。結果はその都度保存し、途中で止まっても続きから再開できる。
2. 最後の1回で、選定・企画担当の案・監査の確認をまとめて行い、厳しい選定基準（docs/ai-team/buyer.md）で合格したものだけを返す。0件でもよい。
3. 1回ごとに検索回数とトークン数を記録して、実際の費用を画面に出す。月の上限を決め、上限を超えたら止める（AI着用イメージと同じ仕組み）。
4. Vercel の実行時間：今は60秒。Fluid compute が有効なら300秒まで上げられるが、1回を短く分けるので60秒のままで動く。

## 社長の確認が必要なこと
1. 案1の従量課金（約15円＋未確認分／回）を使うか。
2. 無料枠の新サービス（Tavily など）に登録するか。
3. **別件**：Vercel の無料プラン（Hobby）は「非商用の個人利用のみ」と公式のFair useに書かれている。アフィリエイト事業の道具に使うことが、これに当たるかの判断。Pro にする場合は月 $20 前後（第三者の資料による）。

## 主な出典
- OpenAI：https://platform.openai.com/docs/pricing/ 、https://developers.openai.com/api/docs/guides/tools-web-search 、https://developers.openai.com/api/docs/models/gpt-5.4-nano
- Tavily：https://docs.tavily.com/documentation/api-credits.md
- Google CSE の終了：https://programmablesearchengine.googleblog.com/
- Bing の終了：https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement
- Brave の無料プラン廃止：https://www.implicator.ai/brave-drops-free-search-api-tier-puts-all-developers-on-metered-billing/
- Gemini の規約：https://ai.google.dev/gemini/terms
- Vercel：https://vercel.com/docs/fluid-compute 、https://vercel.com/docs/plans/hobby
