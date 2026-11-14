// 制作ラインの合格の障害（2026-11-14 本番）：商品カードの短い名前に、商品名にない「18」が入り、修正担当は直せず不合格になった
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFetchMock, aiReply } from './mock.js';
import { withUsage } from '../lib/ai-usage.js';
import * as P from '../lib/production.js';

let mock;
afterEach(() => { if (mock) mock.restore(); mock = null; });
const ENV = { OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app' };
const item = (name, extra = {}) => ({ name, price: 1980, role: '本命', feature: '耐熱の不燃シート', why: '焚き火の地面を守る', caption: '焚き火台の下に敷く不燃シート。', code: 'c:x', url: 'https://item.rakuten.co.jp/s/x/', image: 'x', ...extra });
const SET = { title: '焚き火の“地面熱”対策5選', pattern: 'discovery', patternLabel: '変わり種', target: 'キャンプする人', items: [item('【送料無料】bitstrong 不燃消火シート BS-BF-SH-481 焚き火 耐熱 スパッタシート'), item('焚き火台 シート 耐火 60×60', { price: 2500, code: 'c:y' }), item('耐熱グローブ 牛革 キャンプ', { price: 1200, code: 'c:z' })] };

test('短い名前は商品名からプログラムで作る（AIが書いた「18」は使わない）。商品名にない数字は入らない', async () => {
  mock = installFetchMock({ rakuten: () => ({ ok: true, status: 200, json: async () => ({}) }), openai: () => aiReply({ topicSlug: 't', category: 'キャンプ', caption: '焚き火の下の地面、意外と熱くなる。', hashtags: [], items: [0, 1, 2].map((id) => ({ id, shortName: id === 0 ? 'bitstrong 不燃消火シート 18' : 'シート', subline: '地面を守る', memo: '敷くだけ' })) }) });
  const r = await withUsage(() => P.copyStep({ set: SET, env: ENV }));
  assert.equal(r.ok, true);
  const names = r.copy.items.map((x) => x.shortName);
  assert.ok(!names[0].includes('18'), `短い名前：${names[0]}`);
  names.forEach((n, i) => {
    const digits = n.normalize('NFKC').match(/\d+/g) || [];
    digits.forEach((d) => assert.ok(SET.items[i].name.normalize('NFKC').includes(d), `「${n}」の ${d} は商品名にない`));
    assert.ok(n.length > 0 && n.length <= 20);
  });
  assert.match(names[0], /bitstrong/, 'ブランド名は残す');
  assert.ok(!/送料無料/.test(names[0]), '宣伝文句は削る');
});

test('コードの確認：商品データにない数字（容量・サイズ・性能など）を、カード・キャプション・ROOM紹介文に書いたら不合格', () => {
  const set = { ...SET, copy: { body: '地面の熱を防ぐ5つ。', caption: '地面の熱を防ぐ5つ。\n\n※楽天アフィリエイトを利用しています。', hashtags: [], items: [{ shortName: 'bitstrong 不燃消火シート', subline: '18cm角で使いやすい', memo: '耐熱1000℃' }, { shortName: '焚き火台 シート', subline: '60×60で大きめ', memo: '' }, { shortName: '耐熱グローブ', subline: '', memo: '' }] }, roomTexts: SET.items.map(() => ({ intro: 'あ'.repeat(120) })) };
  const ck = P.codeCheck(set);
  const k = ck.checks.find((x) => x.key === 'numbers');
  assert.ok(k, '数字の確認がある');
  assert.equal(k.ok, false);
  assert.match(k.detail, /18cm/); assert.match(k.detail, /1000(℃|°C)/);
  assert.ok(!/60/.test(k.detail), '商品名にある 60×60 は問題にしない');
  // 短い名前に商品名にない数字が入っていても不合格
  const set2 = { ...set, copy: { ...set.copy, items: [{ shortName: 'bitstrong 不燃消火シート 18', subline: '', memo: '' }, set.copy.items[1], set.copy.items[2]] } };
  assert.equal(P.codeCheck(set2).checks.find((x) => x.key === 'numbers').ok, false);
});

test('同じ直せない理由では、何度もAIを呼ばない：直せない場所への指示・前回直せなかった同じ指示は、修正せずに止める', () => {
  const a1 = { fixes: [{ target: 'card:4', text: '短い名前の「18」を消す' }] };
  const a2 = { fixes: [{ target: 'card:4', text: '短い名前の「18」を消す' }] };
  assert.match(P.unfixable(a2, { audit: a1, fixCheck: [{ target: 'card:4', changed: false }] }) || '', /前回も直せなかった/);
  assert.match(P.unfixable({ fixes: [{ target: 'cover', text: '表紙の文字を変える' }] }, null) || '', /直せない場所/);
  assert.equal(P.unfixable({ fixes: [{ target: 'caption', text: '場面を足す' }] }, null), '', '直せる指示なら止めない');
});
