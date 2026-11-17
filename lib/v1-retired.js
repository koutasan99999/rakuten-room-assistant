// サングラスくま株式会社1.0の運用終了（2026-11-17 社長の決定）。
// 1.0の定期実行・AI社員の自律運営・1.0だけが使うAPI（AI・楽天・Googleを呼ぶもの）を止める。データ・記録・コードは消さない。
// 元に戻すときだけ、Vercelの環境変数 V1_ENABLED=1 を入れる（コードを戻さなくてよい）。
export function v1Enabled(env = process.env) {
  const v = env && env.V1_ENABLED !== undefined ? env.V1_ENABLED : process.env.V1_ENABLED;
  return String(v == null ? '' : v).trim() === '1';
}
export const V1_RETIRED_MESSAGE = 'サングラスくま株式会社1.0は運用を終了しました（2026-11-17）。現在は2.0（/v2/）をご利用ください。過去の記録は消していません';
// 2.0が使うAPI（止めない）：v2・worker（2.0の定期実行）・image（商品画像の取り込み）・media（表紙画像）・data（1.0の記録の読み出し・保存）・kuma-master・ig（AIを使わない）
export const V1_ONLY_ROUTES = new Set(['pitch', 'company', 'agents', 'pr', 'explore', 'buyer', 'thief', 'intros', 'room-hashtags', 'instagram', 'assets', 'coord', 'coord-image', 'ideas', 'seed-ideas', 'release-ideas', 'plan-titles', 'plans', 'brand-note', 'discover', 'search', 'health', 'trends', 'furusato', 'radar', 'product-url']);
