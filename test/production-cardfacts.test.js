// 商品カードの補足文・一言メモ（2026-11-14 本番）：AIが書いた「日傘級の遮光タイプ。」が商品データ（完全遮光・遮蔽遮熱）と一致せず、作り話の疑いで不合格
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFetchMock, aiReply } from './mock.js';
import { withUsage } from '../lib/ai-usage.js';
import * as P from '../lib/production.js';

let mock;
afterEach(() => { if (mock) mock.restore(); mock = null; });
const ENV = { OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app' };
const flat = (t) => String(t || '').normalize('NFKC').replace(/\s+/g, '');
const item = (name, caption, extra = {}) => ({ name, caption, price: 2980, role: '本命', feature: '雨の日に便利', why: '雨の日の装備', code: `c:${name.length}`, url: 'https://item.rakuten.co.jp/s/x/', image: 'x', ...extra });
const SET = { title: '雨の日“装備”をスマートに', pattern: 'discovery', patternLabel: '変わり種', target: '通勤する人', items: [
  item('折りたたみ傘 晴雨兼用 完全遮光 軽量', '【送料無料】完全遮光の生地で、遮蔽遮熱。軽量で持ち運びしやすい折りたたみ傘。ポイント10倍！'),
  item('レインカバー リュック用 防水', '急な雨でもリュックを守る防水カバー。'),
  item('長靴 レインブーツ メンズ', '') // 説明なし
] };

test('補足文・一言メモは、商品データ（名前・説明）にそのままある短い言葉だけ。AIが書いた「日傘級の遮光タイプ」は使わない。根拠が無ければ空欄', async () => {
  mock = installFetchMock({ rakuten: () => ({ ok: true, status: 200, json: async () => ({}) }), openai: () => aiReply({ topicSlug: 't', category: '雨', caption: '雨の日の装備を整える。', hashtags: [], items: [0, 1, 2].map((id) => ({ id, shortName: 'x', subline: id === 0 ? '日傘級の遮光タイプ。' : '雨でも安心', memo: id === 0 ? '真夏も涼しい' : '一つあると便利' })) }) });
  const r = await withUsage(() => P.copyStep({ set: SET, env: ENV }));
  assert.equal(r.ok, true);
  r.copy.items.forEach((c, i) => {
    const data = flat(`${SET.items[i].name} ${SET.items[i].caption}`);
    for (const t of [c.subline, c.memo]) if (t) assert.ok(data.includes(flat(t)), `カード${i + 1}「${t}」は商品データにそのまま無い`);
    assert.ok(!/日傘級|安心|便利|涼しい/.test(`${c.subline}${c.memo}`), `AIの言い回しが残った：${c.subline}／${c.memo}`);
    assert.ok(String(c.subline || '').length <= 26 && String(c.memo || '').length <= 40, '長文を転載しない');
    assert.ok(!/送料無料|ポイント/.test(`${c.subline}${c.memo}`), '宣伝文句は使わない');
  });
  assert.match(r.copy.items[0].subline, /完全遮光/, '説明にある事実を使う');
  assert.equal(r.copy.items[2].subline, '', '説明が無く名前だけの商品は、補足文を作らない（空欄）');
});

test('コードの確認：カードの補足文・一言メモが商品データにそのまま無ければ不合格（修正担当の書き換えも含む）', () => {
  const set = { ...SET, copy: { body: 'x', caption: 'x ※楽天アフィリエイトを利用しています。', hashtags: [], items: [{ shortName: '折りたたみ傘 晴雨兼用', subline: '日傘級の遮光タイプ。', memo: '' }, { shortName: 'レインカバー', subline: '急な雨でもリュックを守る防水カバー', memo: '' }, { shortName: '長靴', subline: '', memo: '' }] }, roomTexts: SET.items.map(() => ({ intro: 'あ'.repeat(120) })) };
  const k = P.codeCheck(set).checks.find((x) => x.key === 'card_facts');
  assert.ok(k, 'カードの根拠の確認がある');
  assert.equal(k.ok, false); assert.match(k.detail, /日傘級/);
  assert.ok(!/急な雨/.test(k.detail));
  // 修正担当が根拠の無い文を書いても、カードには入れない
  const a = P.applyEdit(set, { caption: '', card: [{ n: 1, subline: '真夏も涼しい日傘級', memo: '' }, { n: 2, subline: '防水カバー', memo: '' }], room: [] });
  assert.equal(a.set.copy.items[0].subline, '日傘級の遮光タイプ。', '根拠の無い書き換えは入れない（元のまま）');
  assert.equal(a.set.copy.items[1].subline, '防水カバー', '商品データにある言葉なら入れる');
  assert.ok(a.rejected && a.rejected.some((x) => /card:1/.test(x)), '入れなかった書き換えを記録する');
});
