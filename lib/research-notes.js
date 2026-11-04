// AI社員が会議で使う「調査済みの記録」。実際に調べた内容・調べられなかった内容・出典・調査日を残す（AIに調査結果を作らせない）。
// 調べ直したら、この記録を更新する（調べていないことを「調査済み」と書かない）。
export const RESEARCH_NOTES = [
  {
    id: 'rakuten_images',
    topic: '楽天の商品画像をInstagramの投稿画像に使ってよいか',
    checked: '2026-11-05',
    by: 'Claude Code（開発担当）がWeb検索と公式ページの取得で調査',
    confirmed: [
      'Web検索の結果には、楽天アフィリエイトの商品画像をInstagramで使ってよいかを定めた規約の文面は見つからなかった',
      'Instagramの商品タグ（ショッピング機能）には、楽天などのECモールのURLは使えないとの情報がある（第三者の解説）'
    ],
    unconfirmed: [
      '楽天アフィリエイト・楽天ウェブサービスの規約の原文（affiliate.rakuten.co.jp・webservice.rakuten.co.jp は、この作業環境から閲覧できなかった）'
    ],
    options: [
      { id: 'A', name: '商品写真を使わない版（文字・番号・ポイント・価格・くまで構成）', cost: '0円', owner: '不要（社員だけで作れる）', recommend: true, why: '規約が未確認でも、画像の権利の問題が起きない。今のアプリで作れる' },
      { id: 'B', name: '社長が撮影した写真を使う', cost: '0円', owner: '社長の撮影が必要（週1時間以内の方針と相反しうる）', recommend: false, why: '写真の質は上がるが、社長の作業が増える' },
      { id: 'C', name: '社長がブラウザで楽天アフィリエイトの規約を確認する', cost: '0円', owner: '規約ページを開いて、画像の利用の条文を確認（社員はこの環境から閲覧できない）', recommend: false, why: '使ってよいと分かれば、今の写真入りの投稿セットをそのまま使える' }
    ],
    sources: ['https://www.koukoku.jp/service/suketto/marketer/sns/instagram%e3%81%ae%e5%95%86%e5%93%81%e3%82%bf%e3%82%b0%e3%81%a8%e3%81%af%ef%bc%9f%e6%8a%95%e7%a8%bf%e3%83%bb%e3%83%aa%e3%83%bc%e3%83%ab%e3%83%bb%e3%82%b9%e3%83%88%e3%83%bc%e3%83%aa%e3%83%bc%e3%82%ba/', 'https://tatap.jp/knowledge/rakuten-instagram-integration/']
  }
];
