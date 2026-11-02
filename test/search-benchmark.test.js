import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runBenchmark } from '../scripts/search-benchmark.js';
import { findBrand, findKind, allBrands } from '../lib/product-analysis.js';
import { extractModel, guessBrand, readTarget, classifyMatch } from '../lib/product-match.js';

test('ブランドの誤検出：「〇〇風」「〇〇型」「〇〇対応」「〇〇用」「for 〇〇」と、短い表記がほかの言葉の一部のときは数えない', () => {
  for (const n of ['ナイキ風 スニーカー', 'アップル型 ケース', 'Apple Watch 対応 バンド', 'ダイソンV8用 フィルター', 'ニトリ似 クッション', 'イッタラ風 グラス', 'ホカホカ 湯たんぽ', 'アラビアータ ソース']) assert.equal(findBrand(n), null, n);
  for (const [n, b] of [['ナイキ エアフォース1', 'NIKE'], ['NIKE スニーカー', 'NIKE'], ['ザ・ノース・フェイス ヌプシ', 'THE NORTH FACE'], ['BEAMS別注 シャツ', 'BEAMS'], ['ポーター タンカー', 'PORTER']]) assert.equal(findBrand(n).name, b, n);
  // コラボの見分け（allBrands）は今までどおり
  assert.deepEqual(allBrands('BEAMS × NIKE スニーカー'), ['BEAMS', 'NIKE']);
});

test('辞書にないブランドは、商品名の先頭の英字・カタカナの言葉から推定する（素材・形容・種類の言葉は除く）', () => {
  assert.equal(guessBrand('PLAUD NOTE ボイスレコーダー'), 'PLAUD');
  assert.equal(guessBrand('サンワサプライ スリムタップ'), 'サンワサプライ');
  assert.equal(guessBrand('マグネット ケーブルホルダー'), '');
  assert.equal(guessBrand('ワイヤレスイヤホン Bluetooth'), '');
  assert.equal(guessBrand('おしゃれ 収納'), '');
  const t = readTarget({ name: 'PLAUD NOTE ボイスレコーダー' });
  assert.ok(t.brandGuessed);
  // 推定したブランドが商品名に無くても、「違うブランド」とは判定しない
  assert.notEqual(classifyMatch(t, { name: 'NOTE ボイスレコーダー AI 文字起こし' }).match, 'unknown');
});

test('型番：ハイフン・スラッシュ付きはそのまま、括弧の色記号は外す。数字だけはブランドのすぐ後ろのときだけ。容量・端末名は型番にしない', () => {
  assert.equal(extractModel('アラジン グラファイトトースター AET-GS13C(G)'), 'AET-GS13C');
  assert.equal(extractModel('サンワサプライ スリムタップ TAP-SPSLIM8MG-2'), 'TAP-SPSLIM8MG-2');
  assert.equal(extractModel('SONY WH-1000XM5 ヘッドホン'), 'WH-1000XM5');
  assert.equal(extractModel('New Balance 574 スニーカー', 'New Balance'), '574');
  assert.equal(extractModel('スニーカー 574', ''), '');
  assert.equal(extractModel('Anker PowerCore 10000 10000mAh', 'Anker'), '');
  assert.equal(extractModel('iPhone15 対応 ケース 3in1 USB-C'), '');
  // 型番の照合：色の記号違いは同一、末尾が違う（仕様違い）は類似、数字だけの型番は英字付きと一致しても類似
  const t = readTarget({ name: 'BALMUDA The Toaster K11A' });
  assert.equal(classifyMatch(t, { name: 'バルミューダ ザ・トースター K11A-BK' }).match, 'same');
  assert.equal(classifyMatch(t, { name: 'バルミューダ ザ・トースター Pro K11A-SE' }).match, 'similar');
  assert.equal(classifyMatch(readTarget({ name: 'New Balance 574 スニーカー' }), { name: 'ニューバランス U574 スニーカー' }).match, 'similar');
});

test('商品の種類：別の言葉の一部（マグネット・ライトグレー・マウスピース）や「ホルダー」「用」が続くときは、その種類にしない', () => {
  for (const [n, k] of [['マグネット ペンホルダー デスク', 'ホルダー'], ['ライトグレー パーカー', 'パーカー'], ['マウスピース スポーツ', ''], ['ボトルホルダー 自転車', 'ホルダー'], ['ノートパソコン スタンド', 'ノートパソコン'],
    ['リングライト 自撮り', 'リングライト'], ['iPhone15 対応 ケース 手帳型', 'スマホケース'], ['サンワサプライ スリムタップ', '電源タップ'], ['BALMUDA The Toaster', 'トースター'], ['象印 ステンレスマグ', 'マグ'], ['トートバッグ キャンバス', 'トートバッグ']]) assert.equal(findKind(n), k, n);
});

test('同じ20商品での比較：ブランド・型番・種類を取り違えず、別の商品を同一と判定しない。検索回数は1商品あたり平均3.5回以内', async () => {
  const { total } = await runBenchmark(fileURLToPath(new URL('../lib', import.meta.url)));
  assert.ok(total.brand >= 19, `ブランド ${total.brand}/20`);
  assert.ok(total.model >= 19, `型番 ${total.model}/20`);
  assert.ok(total.kind >= 19, `種類 ${total.kind}/20`);
  assert.equal(total.falseSame, 0);
  assert.ok(total.found >= 19, `本物を発見 ${total.found}/20`);
  assert.ok(total.calls <= 70, `検索回数 ${total.calls}`);
});
