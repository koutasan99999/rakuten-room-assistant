// 紹介番号（KOT-11）：商品ごとの一意の連番。InstagramのキャプションとROOM紹介文に同じ番号。重複・再利用なし。既存データを壊さない
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import { ensureNumbers, formatNo, withNo, captionNoLines, listNumbers, parseNo } from '../lib/product-no.js';
import { assembleCaption } from '../lib/instagram.js';
import * as P from '../lib/production.js';
import * as V from '../lib/v2/company.js';
import { installFetchMock, aiReply } from './mock.js';
import { withUsage } from '../lib/ai-usage.js';

let mock;
afterEach(() => { if (mock) mock.restore(); mock = null; });
const it = (code, name = `商品${code}`) => ({ code, name, url: `https://item.rakuten.co.jp/s/${code}/`, price: 3000 });

test('番号は No.001 から連番・商品ごとに1つ。同じ商品は何度付けても同じ番号・別の商品に再利用しない', async () => {
  const kv = memoryKv();
  const a = [it('a'), it('b')];
  await ensureNumbers(kv, a);
  assert.deepEqual(a.map((x) => x.no), ['No.001', 'No.002']);
  const b = [it('b'), it('c')]; // b は既存・c は新規
  await ensureNumbers(kv, b);
  assert.deepEqual(b.map((x) => x.no), ['No.002', 'No.003']);
  const again = [it('a')];
  await ensureNumbers(kv, again);
  assert.equal(again[0].no, 'No.001');
  assert.equal(formatNo(23), 'No.023'); assert.equal(parseNo('No.023'), 23);
});

test('同時に付番しても、同じ番号を2つの商品に渡さない', async () => {
  const kv = memoryKv();
  const lists = Array.from({ length: 8 }, (_, i) => [it(`p${i}`), it(`q${i}`)]);
  await Promise.all(lists.map((l) => ensureNumbers(kv, l)));
  const nos = lists.flat().map((x) => x.no);
  assert.equal(new Set(nos).size, 16);
  assert.equal((await listNumbers(kv)).length, 16);
});

test('保存場所が未接続のときは番号を作り話で付けない', async () => {
  const items = [it('a')];
  const r = await ensureNumbers(null, items);
  assert.equal(r.skipped, true); assert.equal(items[0].no, undefined);
});

test('キャプションとROOM紹介文に同じ番号・番号の案内は検索できるとは言わない', () => {
  const nos = [{ no: 'No.023', name: '折りたたみ傘' }, { no: 'No.024', name: 'レインカバー' }];
  const cap = assembleCaption({ body: '本文', collection: '雨の日', hashtags: ['#a'], nos });
  assert.match(cap, /No\.023 折りたたみ傘/); assert.match(cap, /No\.024/);
  assert.match(cap, /アフィリエイト/, 'PR表記は残る');
  assert.ok(!/検索/.test(captionNoLines(nos)), 'ROOM内の検索は未確認なので、検索できるとは書かない');
  assert.equal(assembleCaption({ body: '本文', hashtags: [] }).includes('No.'), false, '番号が無ければ今までどおり');
  assert.equal(withNo('紹介文', 'No.023'), '【No.023】紹介文');
  assert.equal(withNo(withNo('紹介文', 'No.023'), 'No.023'), '【No.023】紹介文', '2回付けても同じ');
});

test('投稿セット制作：copyStep と roomStep で同じ番号になり、作り直しても変わらない', async () => {
  const kv = memoryKv();
  const env = { OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app', __kv: kv };
  const mk = () => ({ title: '雨の日の装備', pattern: 'discovery', patternLabel: '変わり種', target: '通勤する人', items: [
    { ...it('a', '折りたたみ傘 軽量'), role: '本命', feature: '軽い', why: '雨の日', caption: '軽量の折りたたみ傘。', image: 'x' },
    { ...it('b', 'レインカバー 防水'), role: '代替', feature: '防水', why: '雨の日', caption: '防水カバー。', image: 'x' }
  ] });
  mock = installFetchMock({ rakuten: () => ({ ok: true, status: 200, json: async () => ({}) }), openai: () => aiReply({ topicSlug: 't', category: '雨', caption: '雨の日の装備を整える。', hashtags: [], intros: ['紹介文その1です。', '紹介文その2です。'], items: [0, 1].map((i) => ({ id: i, shortName: `名前${i}`, subline: '', memo: '', slug: `s${i}` })) }) });
  const set = mk();
  const c = await withUsage(() => P.copyStep({ set, env }));
  assert.equal(c.ok, true);
  assert.deepEqual(set.items.map((x) => x.no), ['No.001', 'No.002']);
  assert.match(c.copy.caption, /No\.001/); assert.match(c.copy.caption, /No\.002/);
  assert.deepEqual(c.copy.items.map((x) => x.no), ['No.001', 'No.002']);
  const redo = mk(); // 作り直し：新しい商品オブジェクトでも同じ番号
  await withUsage(() => P.copyStep({ set: redo, env }));
  assert.deepEqual(redo.items.map((x) => x.no), ['No.001', 'No.002']);
  const chk = P.codeCheck({ ...set, copy: c.copy, roomTexts: [] }).checks.find((k) => k.key === 'numbers_no');
  assert.equal(chk.ok, true);
  const bad = P.codeCheck({ ...set, copy: { ...c.copy, caption: c.copy.caption.replace(/No\.002/g, '') }, roomTexts: [] }).checks.find((k) => k.key === 'numbers_no');
  assert.equal(bad.ok, false, 'キャプションから番号が消えたら不合格');
  const edited = P.applyEdit({ ...set, copy: c.copy, roomTexts: [{ intro: 'a' }, { intro: 'b' }] }, { caption: '直した本文', room: [], card: [] });
  assert.match(edited.set.copy.caption, /No\.001/, '修正してもキャプションの番号は残る');
});

test('管理画面：一覧と、既存の完成品への移行（番号の無いものだけ・中身は消さない・何度やっても同じ・番号は衝突しない）', async () => {
  const kv = memoryKv();
  const mkSet = (id, at, codes) => ({ id, title: `t${id}`, deliveredAt: at, status: 'waiting', caption: '古いキャプション', products: codes.map((c) => ({ code: c, name: `商品${c}`, url: `https://item.rakuten.co.jp/s/${c}/`, room: `紹介文${c}` })) });
  const s1 = mkSet('s1', '2026-11-01', ['a', 'b']); const s2 = mkSet('s2', '2026-11-02', ['b', 'c']);
  await kv.setJson(V.V2_KEYS.set('s1'), s1); await kv.setJson(V.V2_KEYS.set('s2'), s2);
  await kv.setJson(V.V2_KEYS.sets, [{ id: 's2', deliveredAt: s2.deliveredAt }, { id: 's1', deliveredAt: s1.deliveredAt }]);
  assert.equal((await V.productNumbers(kv)).unnumbered.length, 2);
  const m = await V.migrateProductNumbers(kv);
  assert.deepEqual(m.updated.sort(), ['s1', 's2']);
  const g1 = await kv.getJson(V.V2_KEYS.set('s1')); const g2 = await kv.getJson(V.V2_KEYS.set('s2'));
  assert.deepEqual(g1.products.map((p) => p.no), ['No.001', 'No.002']);
  assert.deepEqual(g2.products.map((p) => p.no), ['No.002', 'No.003'], '同じ商品は同じ番号');
  assert.equal(g1.caption, '古いキャプション', 'キャプションは書き換えない');
  assert.equal(g1.products[0].room, '【No.001】紹介文a');
  assert.deepEqual((await V.migrateProductNumbers(kv)).updated, [], '2回目は何も変えない');
  const list = await V.productNumbers(kv);
  assert.equal(list.numbers.length, 3); assert.equal(list.unnumbered.length, 0);
  assert.deepEqual(list.numbers.find((n) => n.no === 'No.002').sets.map((x) => x.id).sort(), ['s1', 's2']);
});
