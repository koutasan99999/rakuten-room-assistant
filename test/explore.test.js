import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import exploreApi from '../api/explore.js';
import introsApi from '../api/intros.js';
import { balanceSelection, buildPool, fallbackAngles, readBrief, ROLE_TAGS } from '../lib/explore.js';
import { fallbackIdea } from '../lib/ideas.js';
import { CATALOG, POST_TYPES } from '../lib/catalog.js';
import { installFetchMock, makeItems, json, aiReply, GOOD_INTRO } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', OPENAI_API_KEY: 'sk-test' };
let mock;
afterEach(() => mock && mock.restore());

async function call(handler, body) {
  const req = { method: 'POST', headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await handler(req, res, ENV);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

// 検索語ごとに別の商品・別のショップを返す楽天の偽物
function rakuten(url) {
  const kw = url.searchParams.get('keyword').replace(/\s/g, '');
  const page = url.searchParams.get('page');
  const min = Number(url.searchParams.get('minPrice')) || 800;
  return json(200, { items: makeItems(10, `${kw}p${page}-`).map((it, i) => ({ ...it, itemPrice: min + i * 50, shopName: `${kw}店${i % 4}` })), pageCount: 3 });
}

const ANGLES = ['王道ブランド', '価格を抑えた代替', 'SNSで話題', '実用品', '新興ブランド', '記念品', '消耗品', '変わり種'].map((label, i) => ({ label, keyword: `角度${i} 検索語`, minPrice: null, maxPrice: null }));
const isAngles = (body) => body.messages[0].content.includes('探索係');
const isSelect = (body) => body.messages[0].content.includes('リサーチ担当');

function selectReply(ids) {
  return aiReply({
    items: ids.map((id, i) => ({
      id, role: ROLE_TAGS[i % ROLE_TAGS.length], tags: ['プレゼント向き'], shortName: `短い名前${id}`, brand: `ブランド${i}`, kind: `種類${i}`,
      reason: '取っ手が畳めて、引き出しにそのまま入る形が良い。', memo: '迷ったらまずこれでいい枠。'
    }))
  });
}

const idea = () => fallbackIdea({ genre: CATALOG.find((c) => c.id === 'baby'), type: POST_TYPES.find((t) => t.id === 'gift'), items: ['出産祝い'] });

test('企画で探す：検索の角度を8つに広げて楽天で探し、AIが15〜20件に役割を付けて返す', async () => {
  mock = installFetchMock({
    rakuten,
    openai: (body) => isAngles(body) ? aiReply({ angles: ANGLES }) : selectReply(Array.from({ length: 20 }, (_, i) => i * 3))
  });
  const { status, data } = await call(exploreApi, { idea: idea() });
  assert.equal(status, 200);
  assert.deepEqual(mock.calls.rakuten.map((c) => c.url.searchParams.get('keyword')), ANGLES.map((a) => a.keyword));
  assert.deepEqual(data.angles.map((a) => a.label), ANGLES.map((a) => a.label));
  assert.ok(data.candidates.length >= 15 && data.candidates.length <= 20, String(data.candidates.length));
  const c = data.candidates[0];
  assert.equal(c.shortName, '短い名前0');
  assert.ok(ROLE_TAGS.includes(c.role));
  assert.ok(c.reason && c.memo && c.url && c.image && c.caption);
  assert.equal(data.idea.topic, idea().topic);
  assert.equal(data.brief.type, 'gift');
  // 役割は同じものが3件まで
  const roles = {};
  for (const x of data.candidates) roles[x.role] = (roles[x.role] || 0) + 1;
  assert.ok(Object.values(roles).every((n) => n <= 3), JSON.stringify(roles));
  // AIへの指示：幅を出す・ブランドは2個まで・企画の検索語をヒントに
  const angleUser = mock.calls.openai.find(isAngles).messages[1].content;
  assert.match(angleUser, /検索語のヒント/);
  assert.match(angleUser, /作る角度の数: 8/);
  const select = mock.calls.openai.find(isSelect).messages;
  assert.match(select[0].content, /同じブランドは2個まで/);
  assert.match(select[0].content, /こんなのもあるのか/);
  assert.match(select[1].content, /探した角度: 王道ブランド/);
});

test('ブランド・役割・種類が偏らないように並べる', () => {
  const mk = (i, brand, role, kind, tags = []) => ({ code: `c${i}`, brand, role, kind, tags });
  const list = [
    mk(0, 'STANLEY', '本命', 'タンブラー'), mk(1, 'stanley', '本命', 'ボトル'), mk(2, 'STANLEY', 'コスパ', 'マグ'),
    mk(3, 'A', '本命', 'タオル'), mk(4, 'B', '本命', 'タオル', ['実用品']), mk(5, 'C', 'コスパ', 'タオル'), mk(6, 'D', 'コスパ', 'タオル'),
    mk(7, 'E', '変わり種', 'おもちゃ'), mk(8, 'F', 'トレンド枠', '食器')
  ];
  const out = balanceSelection(list.map((x) => ({ ...x })), { want: 20, min: 5 });
  const codes = out.map((x) => x.code);
  assert.ok(!codes.includes('c2'), '同じブランドの3個目は外す');
  assert.equal(out.find((x) => x.code === 'c4').role, '実用品'); // 本命が3個そろったので、ほかに当てはまる役割へ
  assert.ok(!codes.includes('c6'), '同じ種類（タオル）の4個目は外す');
  // 数が足りないときだけ、後回しにしたものを足す（同じブランドは3個目まで）
  const few = balanceSelection(list.map((x) => ({ ...x })), { want: 20, min: 9 });
  assert.equal(few.length, 9);
});

test('過去に出した商品は後ろに回して「以前も候補に出た」と伝え、表示済みの商品は出さない', () => {
  const items = (p) => makeItems(3, p).map((it) => ({ code: it.itemCode, name: it.itemName, shop: p, price: 1000, caption: '' }));
  const results = [{ angle: { label: 'A' }, items: items('あ') }, { angle: { label: 'B' }, items: items('い') }];
  const pool = buildPool({ results, seen: [{ code: 'shop:あ0', name: '' }, { name: 'い1 おしゃれな収納ボックス タイプ1' }], exclude: { codes: ['shop:い2'] } });
  assert.deepEqual(pool.map((x) => x.code), ['shop:い0', 'shop:あ1', 'shop:あ2', 'shop:あ0', 'shop:い1']);
  assert.deepEqual(pool.map((x) => x.seenBefore), [false, false, false, true, true]);
  assert.equal(pool[0].angle, 'B');
});

test('さらに10件：表示済みの商品と前回の角度を避けて、10件だけ探す', async () => {
  mock = installFetchMock({
    rakuten,
    openai: (body) => isAngles(body) ? aiReply({ angles: ANGLES.slice(0, 6).map((a, i) => ({ ...a, keyword: `新しい${i} 検索語` })) }) : selectReply(Array.from({ length: 14 }, (_, i) => i))
  });
  const brief = readBrief({ type: 'gift', title: '出産祝いについて本気出して考えてみた' });
  const shown = makeItems(10, '新しい0検索語p1-').map((x) => x.itemCode);
  const { data } = await call(exploreApi, {
    more: { brief, angles: [{ label: '王道ブランド', keyword: '今治 タオル' }] },
    exclude: { codes: shown, names: [] }
  });
  assert.equal(data.candidates.length, 10);
  assert.ok(data.candidates.every((c) => !shown.includes(c.code)));
  assert.equal(mock.calls.rakuten.length, 6);
  const angleUser = mock.calls.openai.find(isAngles).messages[1].content;
  assert.match(angleUser, /避ける角度.*王道ブランド（今治 タオル）/);
  assert.match(angleUser, /作る角度の数: 6/);
});

test('AIが使えなくても、企画の検索語から角度を作って候補を並べる', async () => {
  mock = installFetchMock({ rakuten, openai: () => aiReply('だめ') });
  const i = idea();
  const { status, data } = await call(exploreApi, { idea: i });
  assert.equal(status, 200);
  assert.ok(mock.calls.rakuten.length >= 6);
  assert.equal(mock.calls.rakuten[0].url.searchParams.get('keyword'), i.slots[0].keyword);
  assert.ok(data.candidates.length >= 15);
  assert.match(data.notice, /AIでの選定に失敗/);
  assert.ok(data.candidates[0].reason.includes('方向で見つけた候補'));
});

test('前回の角度の検索語が尽きたら、同じ角度の次のページを見る', () => {
  const brief = readBrief({ title: 'x', hints: ['タオル'] });
  const angles = fallbackAngles(brief, 5, [{ label: '定番', keyword: 'タオル' }]);
  assert.deepEqual(angles, [{ label: '定番', keyword: 'タオル', page: 2 }]);
});

test('条件指定：詳細条件（価格・ターゲット・年齢・プレゼント・ブランド重視）をAIに渡す', async () => {
  mock = installFetchMock({
    rakuten,
    openai: (body) => isAngles(body) ? aiReply({ angles: ANGLES.map((a) => ({ ...a, maxPrice: 50000 })) }) : selectReply(Array.from({ length: 16 }, (_, i) => i))
  });
  const { data } = await call(exploreApi, {
    genre: 'fashion', type: 'trend', free: '財布',
    details: { minPrice: 3000, maxPrice: 8000, target: '後輩', age: '20代', purpose: 'gift', brandFocus: true }
  });
  assert.equal(data.typeName, 'トレンド');
  assert.equal(data.title, '財布');
  const user = mock.calls.openai.find(isAngles).messages[1].content;
  for (const re of [/ターゲット: 後輩/, /年齢: 20代/, /用途: プレゼント/, /価格帯: 3000〜8000円/, /有名ブランドを重視/, /ジャンル: ファッション/]) assert.match(user, re);
  // 予算を大きく超える角度の価格帯は、予算に合わせる
  assert.equal(mock.calls.rakuten[0].url.searchParams.get('maxPrice'), '8000');
});

test('最初の10投稿の企画でも探せる／楽天が使えなければ502／中身がなければ400', async () => {
  mock = installFetchMock({ rakuten, openai: (body) => isAngles(body) ? aiReply({ angles: ANGLES }) : selectReply([0, 1, 2, 3, 4, 5]) });
  const { data } = await call(exploreApi, { planId: 'plan01_shussan' });
  assert.equal(data.plan.no, 1);
  assert.match(mock.calls.openai[0].messages[1].content, /出産祝いについて本気出して考えてみた/);
  assert.match(data.notice, /6件でした/);
  mock.restore();

  mock = installFetchMock({ rakuten: () => json(500, {}), openai: () => aiReply('だめ') });
  const bad = await call(exploreApi, { planId: 'plan01_shussan' });
  assert.equal(bad.status, 502);
  assert.equal((await call(exploreApi, { idea: { topic: '' } })).status, 400);
});

test('選んだ商品の分だけROOM紹介文を作る（AIが失敗しても簡易の紹介文）', async () => {
  mock = installFetchMock({ rakuten, openai: () => aiReply({ items: [{ id: 0, intro: GOOD_INTRO }, { id: 1, intro: GOOD_INTRO }] }) });
  const items = [{ name: '商品A', price: 1000, role: '本命', reason: 'r', caption: '説明' }, { name: '商品B', price: 2000 }];
  const { data } = await call(introsApi, { title: '出産祝い', items });
  assert.equal(data.intros.length, 2);
  assert.equal(data.intros[0], GOOD_INTRO);
  assert.match(mock.calls.openai[0].messages[1].content, /役割: 本命/);
  mock.restore();
  mock = installFetchMock({ rakuten, openai: () => aiReply('だめ') });
  const fb = (await call(introsApi, { items })).data;
  assert.ok(fb.intros[1].includes('商品B'));
  assert.ok(fb.notice);
  assert.equal((await call(introsApi, { items: [] })).status, 400);
});
