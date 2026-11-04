// AI社員がツールを提案するときに使う、確認済みの情報だけをまとめた一覧（AIに料金や機能を作らせないため）。checked は確認日。価格は第三者の情報を含むので、契約前に必ず公式ページで確認する。新しい有料サービスの契約・課金は社長の明示的な承認なしに行わない。
// AI社員がツールを提案するときは、この一覧の id を選ぶだけ。料金・無料範囲・API対応・社長の操作は、この一覧の内容をそのまま表示する。
export const TOOL_CATALOG = [
  {
    "id": "canvas_improve",
    "name": "今のアプリの画像作成（Canvas）を改善",
    "category": "画像制作",
    "free": "無料（今の仕組みのまま。追加の契約なし）",
    "cost": "0円",
    "api": "アプリの中で自動で作れる（すでに投稿セットで使用中）",
    "ownerSteps": "なし",
    "limits": "デザインの型を増やすにはプログラムの改修が必要。商品写真の質は楽天の画像に左右される",
    "sources": [],
    "checked": "2026-11-04"
  },
  {
    "id": "canva_manual",
    "name": "Canva（社長が手で仕上げる）",
    "category": "画像制作",
    "free": "無料プランあり（テンプレート・文字組みを手作業で使える）",
    "cost": "無料プランは0円。有料プランの料金は未確認（契約前に公式ページで確認）",
    "api": "自動化（Autofill API）は Canva Enterprise の組織が必要（有料プランでも開発中の試用のみ）。そのため自動制作には向かない",
    "ownerSteps": "Canvaのアカウント作成。アプリが出した商品一覧・文章をもとに、社長がテンプレートで仕上げる（1投稿あたり手作業が発生）",
    "limits": "社長の作業時間が増える（週1時間以内の方針と相反しうる）",
    "sources": [
      "https://www.canva.dev/docs/connect/api-reference/autofills/",
      "https://canva.dev/docs/connect/autofill-guide"
    ],
    "checked": "2026-11-04"
  },
  {
    "id": "placid",
    "name": "Placid（テンプレートから画像をAPIで作成）",
    "category": "画像制作",
    "free": "透かし入りの無料枠があるとの情報（未確認）",
    "cost": "月19ドル程度からとの第三者情報（料金表は情報源によって異なる。未確認）",
    "api": "APIでテンプレートに文字・画像を流し込んで自動作成できる",
    "ownerSteps": "アカウント作成・テンプレート作成・APIキーをVercelの環境変数に登録・有料契約の承認",
    "limits": "月額費用が発生。今の売上では費用対効果が未検証",
    "sources": [
      "https://www.trustradius.com/products/placid.app",
      "https://toolradar.com/tools/placid/pricing"
    ],
    "checked": "2026-11-04"
  },
  {
    "id": "bannerbear",
    "name": "Bannerbear（テンプレートから画像をAPIで作成）",
    "category": "画像制作",
    "free": "常設の無料プランはなし（試用期間ありとの情報）",
    "cost": "月49ドル程度からとの第三者情報（未確認）",
    "api": "APIでテンプレートに文字・画像を流し込んで自動作成できる",
    "ownerSteps": "アカウント作成・テンプレート作成・APIキーをVercelの環境変数に登録・有料契約の承認",
    "limits": "月額費用が高め。今の売上では費用対効果が未検証",
    "sources": [
      "https://toolradar.com/tools/bannerbear/pricing"
    ],
    "checked": "2026-11-04"
  },
  {
    "id": "server_storage",
    "name": "サーバー側の保存場所（Vercel Blob など）",
    "category": "自動実行",
    "free": "無料枠の範囲は未確認（契約前に公式ページで確認）",
    "cost": "未確認",
    "api": "保存できれば、Vercelの定時実行（Hobbyは1日1回）で、アプリを開かなくても会議を開ける",
    "ownerSteps": "Vercelの管理画面で保存場所を作成・接続（新しいサービスの利用になるため社長の承認が必要）",
    "limits": "今は会社のデータ（採用商品・投稿セット）がiPhoneの中にだけあるため、サーバーの定時実行からは見えない",
    "sources": [
      "https://vercel.com/docs/cron-jobs/usage-and-pricing",
      "https://vercel.com/docs/cron-jobs/manage-cron-jobs"
    ],
    "checked": "2026-11-04"
  }
];

export const PLATFORM_FACTS = [
  {
    "id": "ig_comment",
    "text": "Instagramの公式API（Graph API）では、他のアカウントの投稿に自由にコメントする機能は提供されていない（自分の投稿のコメントと、自分がメンションされた投稿への返信のみ）。非公式な自動操作は規約違反の恐れがあるため行わない",
    "sources": [
      "https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/mentions"
    ],
    "checked": "2026-11-04"
  },
  {
    "id": "vercel_cron",
    "text": "VercelのHobbyプランの定時実行は1日1回まで。指定した時刻の1時間以内のどこかで動く",
    "sources": [
      "https://vercel.com/docs/cron-jobs/usage-and-pricing"
    ],
    "checked": "2026-11-04"
  }
];
