import { OFFICIAL_SITES } from '../lib/ig-discovery.js';
// サングラスくま株式会社 2.0（2026-11-16 24時間の自律運営）：社長の指示なしで仕事を始め、7人が工程ごとに引き継ぎ、
//   複数の案件を並行して進め、投稿できる完成品を社長に納品する。費用の上限は超えない。画面の材料は実際の記録だけ
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { memoryKv } from '../lib/kv.js';
import { withUsage } from '../lib/ai-usage.js';
import * as V from '../lib/v2/company.js';
import worker from '../server/worker.js';
import v2api from '../server/v2.js';
import { spent } from '../lib/budget.js';
import { installFetchMock, json, aiReply, GOOD_INTRO, imageResponse } from './mock.js';

let mock;
afterEach(() => { if (mock) mock.restore(); mock = null; });
const ENV = { OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app', CRON_SECRET: 'sec', APP_PASSCODE: 'pw', __noWait: true };
const APP = 'https://app.test/';
const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7);
const ritem = (code, name, price) => ({ itemCode: code, itemName: name, itemPrice: price, itemUrl: `https://item.rakuten.co.jp/s/${code.replace(/\W/g, '')}/`, mediumImageUrls: ['https://thumbnail.image.rakuten.co.jp/x.jpg'], shopName: 'ショップ', itemCaption: `水受けトレー付きで、水滴がたれにくい。${name}。`, reviewCount: 150, reviewAverage: 4.5, affiliateRate: 4 });
// 楽天の偽物：検索語ごとに違う商品を返す（案件ごとに別の商品になる）
const catalog = (kw) => [0, 1, 2, 3, 4].map((n) => ritem(`s:k${hash(kw)}n${n}`, `${kw} 道具${n}`, 1000 + n * 300));
function fetchMock({ failAi = false, themes = null } = {}) {
  let audits = 0, proposals = 0;
  const T = themes || ['キッチン収納', '鍋まわり', 'コンロ掃除', '水切り', '調味料ラック', '弁当箱', '保存容器', '包丁研ぎ'];
  const m = installFetchMock({
    thumbnail: () => imageResponse(),
    rakuten: (url) => {
      const code = url.searchParams.get('itemCode');
      if (code) { const kw = 'x'; void kw; return json(200, { Items: [ritem(code, `指定の商品 ${code}`, 2480)] }); }
      return json(200, { Items: catalog(url.searchParams.get('keyword') || '') });
    },
    openai: (body) => {
      if (failAi) return json(500, { error: { message: 'server error sk-test' } });
      const sys = body.messages[0].content;
      const user = typeof body.messages[1].content === 'string' ? body.messages[1].content : '';
      if (sys.includes('サングラスくま株式会社」の企画担当')) { const t = T[proposals++ % T.length]; return aiReply({ theme: t, keyword: t, angle: 'classic', target: '自炊する社会人', aim: `${t}の悩みを減らす` }); }
      if (sys.includes('サングラスくま株式会社」のバイヤー')) return aiReply({ ref: 'R1', who: '自炊する社会人', problem: '置き場所', whyNow: '鍋料理が増える季節' });
      if (sys.includes('Instagram企画担当とバイヤー')) return aiReply({ pattern: 'discovery', title: `${(user.match(/A0: ([^/]{2,12})/) || [])[1] || 'キッチン'}の工夫`, target: '料理する人', reason: '置き場所に困る道具を並べる', appeal: '台所が片づく', adopted: [{ id: 0, role: '本命', feature: '水受けトレー付き', why: '置き場所' }], slots: [{ role: '中価格帯', keyword: 'キッチン 道具' }, { role: '低価格帯', keyword: 'キッチン 便利' }] });
      if (sys.includes('企画の枠ごとに')) return aiReply({ picks: [{ slot: 0, id: 0, feature: '水受けトレー付き', why: '台が濡れにくい' }, { slot: 1, id: 1, feature: '水受けトレー付き', why: 'コンロまわり' }] });
      if (sys.includes('投稿文字を作る担当')) return aiReply({ topicSlug: 'kitchen', category: 'キッチン', caption: '台所の置き場所、気づくと散らかりがち。\n\n今回は置き場所に困る道具を3つ並べました。\n\n買う前に見返せるよう、保存しておいてください。', hashtags: ['#キッチン用品', '#台所収納'], cover: { title: 'キッチンの工夫' }, items: [0, 1, 2].map((id) => ({ id, shortName: '道具', subline: '', memo: '' })) });
      if (sys.includes('紹介文を書く担当')) return aiReply({ items: [0, 1, 2].map((id) => ({ id, intro: GOOD_INTRO })) });
      if (sys.includes('監査AIです') && sys.includes('投稿セット（Instagram')) {
        audits++;
        const sc = (a) => ({ accuracy: { score: a[0] }, compliance: { score: a[1] }, concept: { score: a[2] }, appeal: { score: a[3] }, room: { score: a[4] } });
        return audits === 1 ? aiReply({ scores: sc([22, 18, 15, 12, 12]), flags: {}, fixes: [{ target: 'caption', text: '誰のどんな場面かを1文足す' }], proposal: 'revise', summary: '場面が抽象的' })
          : aiReply({ scores: sc([24, 20, 18, 17, 13]), flags: {}, fixes: [], proposal: 'pass', summary: '商品データと一致' });
      }
      if (sys.includes('制作担当AIです')) return aiReply({ caption: '料理のたびに、ふたやトングの置き場所に迷う人へ。\n\n今回は置き場所に困る道具を3つ並べました。\n\n買う前に見返せるよう、保存しておいてください。', room: [], giveUp: '' });
      if (sys.includes('表紙画像担当AIです')) return aiReply({ scenes: [{ usage: '台所で使う', usageQuote: '水受けトレー付き', place: 'キッチン', time: '夕方', action: '料理の途中で道具を使っている', consistency: '自然な向き', camera: '斜め上', productPlacement: '手前で大きく', outfit: 'エプロン', mood: '落ち着いた' }] });
      if (sys.includes('品質確認の担当')) return aiReply({ single: true, character: true, sameAsMaster: true, plush3d: true, productLarge: true, productMatches: true, usingProduct: true, consistent: true, noText: true, noLogo: true, handsOk: true, noMedical: true, warmScene: true, topSpace: true, issues: [] });
      return aiReply({});
    }
  });
  const mocked = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { const u = String(url); if (/kinto|hario|lecreuset|snowpeak|balmuda|thermos|bodum/.test(u)) return new Response('<html><a href="https://www.instagram.com/brand_official/">IG</a></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }); if (u.startsWith(APP)) return new Response(fs.readFileSync(new URL('../' + u.slice(APP.length), import.meta.url)), { status: 200, headers: { 'Content-Type': 'image/png' } }); return mocked(url, opts); };
  return m;
}
const run = (kv, env = ENV) => withUsage(() => V.tick({ kv, env, origin: APP, startedAt: Date.now(), trigger: 'test' }));
const call = async (handler, body, headers = { 'x-app-passcode': 'pw' }, env = ENV) => { const req = { method: 'POST', url: '/api/x', headers, body }; const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } }; await handler(req, res, env); return { status: res.statusCode, data: JSON.parse(res.body) }; };
const today = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
async function untilDelivered(kv, env = ENV, max = 20) { const all = []; for (let i = 0; i < max; i++) { const r = await run(kv, env); all.push(...(r.steps || [])); if ((r.steps || []).some((x) => x.endsWith(':deliver'))) return all; } return all; }

test('実証1・2・5：社長が何も指示しなくても仕事が始まり、7人が工程ごとに自動で引き継ぎ、投稿できる完成品が届く', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  const steps = await untilDelivered(kv);
  const firstPropose = steps.indexOf('planner:propose'); // 集客の施策の案（企画の空き時間の仕事）は工程の順番に数えない
  const mine = steps.filter((x, i) => !x.includes('propose') || i === firstPropose);
  const order = ['planner:propose', 'buyer:find', 'auditor:checkHero', 'planner:plan', 'buyer:gather', 'buyer:pick', 'writer:copy', 'writer:room', 'auditor:auditText', 'editor:edit', 'auditor:auditText', 'editor:review', 'designer:scene', 'designer:image', 'pr:pack:deliver'];
  let k = 0; for (const s of mine) if (s === order[k]) k++;
  assert.equal(k, order.length, `工程の順番：${steps.join(' / ')}`);
  const st = await V.officeState(kv, ENV);
  const ev = [...st.events].reverse();
  assert.match(ev.find((e) => e.type === 'start').text, /社長の指示を待たずに、新しい案件を始めた/);
  assert.match(ev[0].text, /14日間の試験運用を始めた/);
  assert.ok(ev.some((e) => e.type === 'handoff' && e.agent === 'auditor' && e.to === 'editor'), '監査→編集への差し戻し');
  assert.ok(ev.some((e) => e.type === 'handoff' && e.agent === 'editor' && e.to === 'designer'), '編集→デザイナー');
  assert.ok(ev.some((e) => e.type === 'handoff' && e.agent === 'designer' && e.to === 'pr'), 'デザイナー→広報（画像は1枚・監査の描き直しなし）');
  assert.ok(ev.every((e) => !('dev' in e)), '開発者向けの記録は社長の画面に出さない');
  // 完成品：投稿にそのまま移れるもの
  const set = await V.getSet(kv, st.sets[0].id);
  assert.ok(set.theme && set.aim && set.target, 'テーマ・狙い・対象');
  assert.equal(set.products[0].role, '本命'); assert.equal(set.products[1].role, '代替・比較');
  assert.match(set.products[0].check, /楽天で再確認済み/); assert.ok(set.products.every((p) => p.url && p.image && p.price && p.room.length >= 80));
  assert.ok(set.compare.length >= 2 && /本命より\d|本命と同じ/.test(set.compare[0].vsHero), '本命と代替の比較');
  assert.ok(set.hashtags.length >= 1 && set.hashtags.every((t) => t.startsWith('#')));
  assert.ok(set.notes.some((n) => /AI生成イメージ/.test(n)) && set.notes.some((n) => /価格/.test(n)), '注意事項');
  assert.ok(set.order.length >= 3 && /楽天ROOM/.test(set.order[0]), '推奨の投稿順');
  assert.match(set.caption, /アフィリエイト|PR/); assert.equal(set.image.label, 'AI生成イメージ');
  assert.ok(!('raw' in set) && !('dev' in set));
  assert.equal(st.notices[0].id, set.id, '社長への通知（画面のお知らせ）');
  assert.equal(st.results.delivered, 1); assert.ok(st.results.yenPerSet > 0);
});

test('実証3：画像の予算が足りないときは表紙画像なしで届けず、画像待ちで保存する（描き直しの回数に数えない）。予算が戻ると表紙を描いて届ける（2026-11-18 表紙の無いものは完成品ではない）。各社員は1回の実行で決まった工程数まで', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  await kv.incrFloat(`budget:image:yen:${today()}`, 500); // 今日の画像の目安は使い切り
  await kv.setJson(V.V2_KEYS.trial, { start: new Date(Date.now() - 20 * 86400000).toISOString(), end: new Date(Date.now() - 6 * 86400000).toISOString(), cap: 1000, base: { month: today().slice(0, 7), spent: 0 } }); // 試験運用のあと（通常の上限）
  const env = { ...ENV, IMAGE_DAILY_COUNT: '1' };
  const all = [];
  for (let i = 0; i < 14; i++) {
    const r = await run(kv, env);
    all.push(...(r.steps || []));
    const count = {}; (r.steps || []).forEach((x) => { const a = x.split(':')[0]; count[a] = (count[a] || 0) + 1; });
    assert.ok(Object.values(count).every((n) => n <= V.AGENT_PER_TICK), `1人の社員が1回で${V.AGENT_PER_TICK}工程まで：${r.steps}`);
  }
  assert.ok(!all.some((x) => x.endsWith(':deliver')), `表紙が無いので届けない：${all.join(' / ')}`);
  assert.ok(all.some((x) => x === 'designer:image:wait'), '画像待ちにする');
  assert.equal(mock.calls.images.length, 0, '予算が足りないので画像APIは呼ばない');
  const w = (await kv.getJson(V.V2_KEYS.cases)).find((c) => c.wait && c.wait.kind === 'image');
  assert.ok(w); assert.equal(w.data.imageRounds || 0, 0, '予算待ちは描き直しの回数に数えない');
  // 次の日（予算が戻った）：続きを描いて、表紙つきで届ける
  await kv.del(`budget:image:yen:${today()}`);
  const steps = await untilDelivered(kv, env);
  assert.ok(steps.some((x) => x.endsWith(':deliver')), steps.join(' / '));
  assert.equal(mock.calls.images.length, 1);
  const st = await V.officeState(kv, env);
  assert.ok((await V.getSet(kv, st.sets[0].id)).image.mediaId, '表紙つきで届く');
});
test('実証4：完成したら、社長の操作なしに次の案件が自動で始まる。同じ企画は繰り返さない', async () => {
  mock = fetchMock({ themes: ['キッチン収納', 'キッチン収納', '鍋まわり', 'コンロ掃除'] });
  const kv = memoryKv();
  await untilDelivered(kv);
  const r = await run(kv);
  const st = await V.officeState(kv, ENV);
  assert.ok(st.cases.length >= 1 || st.sets.length >= 2, '次の案件がある（速いと、次の案件も同じ回で届く）');
  assert.ok(st.events.some((e) => e.type === 'start' && /指示を待たずに/.test(e.text) && e.at >= st.sets[st.sets.length - 1].deliveredAt), '完成のあとに新しい案件が自動で始まった');
  void r;
  // 同じテーマ（キッチン収納）が2回目に出ても、似た企画として弾いて考え直す
  for (let i = 0; i < 4; i++) await run(kv);
  const st2 = await V.officeState(kv, ENV);
  assert.ok(st2.events.some((e) => /最近と似た企画/.test(e.text)), '似た企画を弾いた');
  assert.ok(st2.results.dupRate > 0, '企画の重複率を数えている');
});

test('実証6：費用の上限を超えない。試験運用中は1日25円で止めず、月1,000円・期間の合計1,000円に届いたら「予算待ち」になり、余地ができたら自動で続ける', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  const env = { ...ENV, AUTONOMY_DAILY_YEN: '3' };
  for (let i = 0; i < 6; i++) await run(kv, env);
  assert.ok((await spent(kv)).dayAuto > 3, '試験運用中は1日の上限（ここでは3円）で止めない');
  const month = today().slice(0, 7);
  const kv2 = memoryKv();
  await kv2.incrFloat(`budget:month:${month}`, 999.5); // 月の上限の手前
  await kv2.setJson(V.V2_KEYS.cases, [{ id: 'jb', kind: 'make', step: 'propose', attempts: 0, runs: [], wait: null, data: {} }]); // 途中の案件
  for (let i = 0; i < 4; i++) await run(kv2, env);
  const s = await spent(kv2);
  assert.ok(s.month <= 1000, `今月の費用 ${s.month}円（上限1,000円を超えない）`);
  assert.equal((await kv2.getJson(V.V2_KEYS.cases)).length, 1, '上限の手前では新しい案件を始めない');
  const st = await V.officeState(kv2, env);
  assert.ok(st.cases.some((c) => c.wait && c.wait.kind === 'budget'), `予算待ちの案件：${JSON.stringify(st.cases.map((c) => [c.step, c.wait]))}`);
  assert.ok(st.staff.some((x) => x.status === 'budget'), '社員の状態に「予算待ち」');
  assert.ok(st.events.some((e) => e.type === 'budget'));
});

test('試験運用が終わったら、通常の上限（1日25円）に戻る（自動で増やさない）', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  const env = { ...ENV, AUTONOMY_DAILY_YEN: '3' };
  await run(kv, env);
  const t = await kv.getJson(V.V2_KEYS.trial); t.end = new Date(Date.now() - 1000).toISOString(); await kv.setJson(V.V2_KEYS.trial, t);
  for (let i = 0; i < 8; i++) await run(kv, env);
  assert.ok((await spent(kv)).dayAuto <= 3 + 1, '試験後は1日の上限で止まる');
  assert.equal((await V.officeState(kv, env)).trial.active, false);
});

test('失敗は時間を空けて再試行（エラー表示）し、3回目で理由を残して止まる。鍵は記録に出さない', async () => {
  mock = fetchMock({ failAi: true });
  const kv = memoryKv();
  await run(kv);
  let st = await V.officeState(kv, ENV);
  assert.equal(st.cases[0].wait.kind, 'retry');
  assert.equal(st.staff.find((s) => s.id === 'planner').status, 'error');
  for (let i = 0; i < 2; i++) { const cs = await kv.getJson(V.V2_KEYS.cases); cs.forEach((c) => { if (c.wait) c.wait.until = new Date(Date.now() - 1000).toISOString(); }); await kv.setJson(V.V2_KEYS.cases, cs); await run(kv); }
  st = await V.officeState(kv, ENV);
  assert.ok(st.events.some((e) => e.type === 'stop'));
  assert.ok(!JSON.stringify(await kv.listJson(V.V2_KEYS.events, 50)).includes('sk-test'), '鍵を記録に出さない');
});

test('社長の指定（テーマ・商品のURL）は次の新しい案件で優先する', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  const E = { ...ENV, __kv: kv };
  assert.equal((await call(v2api, { action: 'request', url: 'https://example.com/x' }, undefined, E)).status, 400);
  await call(v2api, { action: 'request', url: 'https://item.rakuten.co.jp/shopa/item-123/' }, undefined, E);
  const r = await run(kv);
  assert.ok((r.steps || []).includes('buyer:find'));
  const st = await V.officeState(kv, ENV);
  assert.ok(st.events.some((e) => /社長の指定/.test(e.text)));
  assert.ok(st.events.some((e) => /指定の商品「/.test(e.text)), '指定の商品を楽天で引いた');
  assert.equal(st.requests.length, 0);
});

test('社長の修正依頼は、編集→監査→編集（整合性）→広報で直して届け直す。採用・投稿したは記録と成果に残る', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  const E = { ...ENV, __kv: kv };
  await untilDelivered(kv);
  const id = (await V.officeState(kv, ENV)).sets[0].id;
  assert.equal((await call(v2api, { action: 'decide', id, decision: 'revise' }, undefined, E)).status, 400);
  await call(v2api, { action: 'decide', id, decision: 'revise', note: 'もっと短く' }, undefined, E);
  const steps = [];
  for (let i = 0; i < 6; i++) { const r = await run(kv); steps.push(...(r.steps || [])); if (steps.some((x) => x.startsWith('pr:pack'))) break; }
  const evs = [...(await V.officeState(kv, ENV)).events].reverse().filter((e) => String(e.job || '').startsWith('fix') && e.type === 'done').map((e) => e.agent);
  assert.deepEqual(evs.slice(0, 4), ['editor', 'auditor', 'editor', 'pr'], `修正の案件だけの順番：${evs.join(' / ')}（全体：${steps.join(' / ')}）`);
  assert.equal((await V.getSet(kv, id)).revisions, 1);
  await call(v2api, { action: 'decide', id, decision: 'adopt' }, undefined, E);
  await call(v2api, { action: 'decide', id, decision: 'posted' }, undefined, E);
  const st = await V.officeState(kv, ENV);
  assert.equal(st.sets.find((x) => x.id === id).status, 'posted');
  assert.equal(st.results.posted, 1);
});

test('社員の状態は実際の記録どおり：次の定期実行待ち・引き継ぎ中・仕事なし（働いているふりをしない）', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  await kv.setJson(V.V2_KEYS.cases, [{ id: 'j1', kind: 'make', step: 'copy', attempts: 0, runs: [], wait: null, data: { plan: { title: '企画A' } } }]);
  await V.record(kv, { job: 'j0', agent: 'buyer', to: 'writer', type: 'handoff', text: 'ライターへ引き継ぎ', title: '企画A' });
  const st = await V.officeState(kv, ENV);
  const w = st.staff.find((x) => x.id === 'writer');
  assert.equal(w.status, 'queued'); assert.match(w.doing, /次の番：Instagramの文章を書く/); assert.equal(w.title, '企画A'); assert.match(w.next, /ライター：楽天ROOMの紹介文を書く/);
  assert.equal(st.staff.find((x) => x.id === 'buyer').status, 'handoff');
  assert.ok(st.staff.filter((x) => !['writer', 'buyer'].includes(x.id)).every((x) => x.status === 'idle'));
});

test('旧形式（1件の仕事・画像待ち）は消さずに案件へ移す', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  await kv.setJson(V.V2_KEYS.job, { id: 'old1', kind: 'make', step: 'copy', attempts: 0, runs: [], data: { plan: { title: '旧A' } } });
  await kv.setJson(V.V2_KEYS.imagewait, [{ id: 'old2', kind: 'make', step: 'image', attempts: 0, runs: [], data: { set: { title: '旧B' } } }]);
  await run(kv, { ...ENV, IMAGE_DAILY_COUNT: '1' });
  const cs = await kv.getJson(V.V2_KEYS.cases);
  assert.ok(cs.find((c) => c.id === 'old1') || (await V.officeState(kv, ENV)).events.some((e) => e.job === 'old1'));
  assert.ok(cs.find((c) => c.id === 'old2') || (await V.officeState(kv, ENV)).events.some((e) => e.job === 'old2'), '画像待ちだった旧案件も消さずに移し、続きを進めた（記録に残る）');
});

test('定期実行：切り替え後は2.0だけ・切り替え前は手動の target=v2 と QStash の交互で2.0が動く。APIは合言葉が必要', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  const env = { ...ENV, __kv: kv };
  const tick = (body) => withUsage(() => call(worker, { action: 'tick', ...body }, { authorization: 'Bearer sec', 'x-trigger': 'workflow_dispatch' }, env));
  assert.notEqual((await tick({})).data.company, 'v2');
  await kv.del('worker:lock');
  assert.equal((await tick({ target: 'v2' })).data.company, 'v2');
  assert.equal((await call(v2api, { action: 'state' }, {}, env)).status, 401);
  await call(v2api, { action: 'activate', on: true }, { 'x-app-passcode': 'pw' }, env);
  await kv.del('worker:lock');
  assert.equal((await tick({})).data.company, 'v2');
});

test('試験運用（14日間・合計1,000円）：開始時点の支出を記録し、それ以降の増分だけを数える。上限に届く有料の処理はしない（月の予算と二重に数えない）', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  const month = today().slice(0, 7);
  await kv.incrFloat(`budget:month:${month}`, 300); // 試験の前にすでに使っていた分
  await run(kv);
  let st = await V.officeState(kv, ENV);
  assert.equal(st.trial.baseSpent, 300); assert.ok(st.trial.active);
  assert.ok(st.trial.used > 0 && st.trial.used < 60, `試験の開始後の増分だけ（${st.trial.used}円。並行処理で1回に画像まで進む）`);
  assert.ok(st.trial.left <= 1000 - 300, '使える残りは、今月の残り（1,000円−300円）を超えない（二重に数えない）');
  // 試験の上限に届いたら止める
  const t = await kv.getJson(V.V2_KEYS.trial); t.base.spent = -2000; await kv.setJson(V.V2_KEYS.trial, t); // 期間中にすでに1,000円を使ったことにする
  const calls0 = mock.calls.openai.length + mock.calls.images.length;
  await run(kv);
  st = await V.officeState(kv, ENV);
  assert.equal(mock.calls.openai.length + mock.calls.images.length, calls0, '試験の上限に届いたら、有料の処理（文章・画像）をしない');
  assert.ok(st.cases.every((c) => !c.wait || c.wait.kind === 'budget'), '進行中の案件があれば予算待ち');
});

test('選定理由と価格帯が完成品に入る（表紙つき）', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  await untilDelivered(kv);
  const s = await V.getSet(kv, (await V.officeState(kv, ENV)).sets[0].id);
  assert.ok(s.image && s.image.mediaId, '表紙つきで届く');
  assert.ok(s.caption && s.products.length >= 3);
  assert.ok(s.band && s.products.every((p) => p.band), '価格帯の目安');
  assert.equal(V.bandOf(2500), '手頃な高コスパ'); assert.equal(V.bandOf(25000), '高級・特別なギフト');
});
test('完成品ページ：Instagramの画像の材料（短い名前・商品番号）を渡し、楽天ROOMに登録した記録を残せる（社長の申告）', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  const E = { ...ENV, __kv: kv };
  await untilDelivered(kv);
  const id = (await V.officeState(kv, ENV)).sets[0].id;
  let s = (await call(v2api, { action: 'set', id }, undefined, E)).data.set;
  assert.ok(s.products.every((p) => p.code && p.shortName), '商品番号と短い名前');
  assert.ok(s.slides && s.slides.topic);
  await call(v2api, { action: 'room', id, code: s.products[0].code }, undefined, E);
  s = (await call(v2api, { action: 'set', id }, undefined, E)).data.set;
  assert.equal(s.products[0].roomDone, true); assert.equal(s.products[1].roomDone, false);
  assert.ok((await V.officeState(kv, ENV)).events.some((e) => /楽天ROOMに登録した（社長の申告）/.test(e.text)));
  await call(v2api, { action: 'room', id, code: s.products[0].code, done: false }, undefined, E);
  assert.equal((await call(v2api, { action: 'set', id }, undefined, E)).data.set.products[0].roomDone, false, '取り消せる');
});

// ---- 2026-11-16 並行処理・仕事探し・広報の常設 ----
// AIの応答を遅らせる（同時に進んだかを、工程の開始・終了の時刻で確かめる）。広報のコメント案と、その採点にも答える
function slowAndPr(m, { ms = 150, prPass = true } = {}) {
  const inner = globalThis.fetch;
  const seen = { instagram: 0 };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (/instagram\.com|graph\.facebook\.com/.test(u)) { seen.instagram += 1; throw new Error('Instagramには接続しない'); }
    if (/kinto|hario|lecreuset|snowpeak|balmuda|thermos|bodum/.test(u)) { seen.sites = (seen.sites || 0) + 1; return new Response(`<html><a href="https://www.instagram.com/${u.match(/\/\/(?:www\.)?([a-z]+)/)[1]}_official/">Instagram</a></html>`, { status: 200, headers: { 'Content-Type': 'text/html' } }); }
    if (u.includes('api.openai.com') && !u.includes('/images/')) {
      await new Promise((r) => setTimeout(r, ms));
      const body = JSON.parse(opts.body);
      const sys = body.messages[0].content;
      if (sys.includes('「くまの一言メモ」だけを作ります')) return aiReply({ items: [{ n: 1, memo: '水受けトレー付きで、台が濡れにくい。' }, { n: 2, memo: '私も愛用しています。' }, { n: 3, memo: '真夏も涼しい一本。' }] });
      if (sys.includes('営業・交流担当AIです')) {
        const id = (String(body.messages[1].content).match(/投稿 ([A-Za-z0-9_-]+)（P1/) || [])[1];
        return aiReply({ drafts: [{ id, anchor: '朝の通勤', comment: '朝の通勤で使うなら、どの時間帯がいちばん便利ですか', relevance: 70, relevanceWhy: '通勤の道具', follow: 60, followWhy: '生活の道具の投稿' }] });
      }
      if (sys.includes('監査AIです（コメントを書く役はしない）')) {
        const id = (String(body.messages[1].content).match(/案 ([A-Za-z0-9_-]+)/) || [])[1];
        const sc = prPass ? [22, 22, 17, 13, 13] : [10, 10, 8, 5, 5];
        return aiReply({ audits: [{ id, scores: { specific: { score: sc[0] }, natural: { score: sc[1] }, relevance: { score: sc[2] }, distance: { score: sc[3] }, compliance: { score: sc[4] } }, flags: {}, fixes: prPass ? [] : ['質問を具体的に'], proposal: prPass ? 'pass' : 'revise', summary: prPass ? '投稿の文章に沿っている' : '抽象的' }] });
      }
    }
    return inner(url, opts);
  };
  const restore = m.restore;
  m.restore = () => { globalThis.fetch = inner; restore(); };
  return seen;
}
const overlap = (a, b) => a.from < b.to && b.from < a.to;
const lanesOf = (r) => (r.parallel ? r.parallel.lanes : []).map((x) => { const m = x.match(/^L(\d+) ([\d.]+)-([\d.]+)s (\w+):(\w+)/); return { lane: +m[1], from: +m[2], to: +m[3], agent: m[4], step: m[5] }; });

test('並行：違う案件の工程を同時に進める（同じ案件・同じ社員は同時にしない）。同時処理の件数を記録する', async () => {
  mock = fetchMock();
  slowAndPr(mock, { ms: 200 });
  const kv = memoryKv();
  const base = (id, step, extra = {}) => ({ id, kind: 'make', step, createdAt: new Date().toISOString(), attempts: 0, runs: [], wait: null, data: { theme: `企画${id}`, keyword: `企画${id}`, angle: 'classic', ...extra } });
  await kv.setJson(V.V2_KEYS.cases, [base('a', 'propose'), base('b', 'find'), base('c', 'find')]);
  const r = await run(kv);
  const lanes = lanesOf(r);
  assert.ok(r.parallel.peak >= 2, `同時に進んだ工程の最大数：${r.parallel.peak}（${r.parallel.lanes.join(' / ')}）`);
  assert.ok(lanes.some((x, i) => lanes.some((y, j) => i !== j && x.agent !== y.agent && overlap(x, y))), `違う社員の工程が同じ時間に進んだ：${r.parallel.lanes.join(' / ')}`);
  for (const x of lanes) for (const y of lanes) if (x !== y && x.agent === y.agent) assert.ok(!overlap(x, y), `同じ社員が同時に2つの仕事をしない：${x.agent}`);
  // 同じ案件の工程は順番どおり（同時に進めない）
  const st = await V.officeState(kv, ENV);
  assert.ok(st.peak >= 2 && st.lanes.length >= 3, '画面に前回の同時処理の記録がある');
  const evs = [...st.events].reverse().filter((e) => e.type === 'done' && e.job);
  for (const id of ['a', 'b', 'c']) { const mine = evs.filter((e) => e.job === id); for (let i = 1; i < mine.length; i++) assert.ok(mine[i].at >= mine[i - 1].at); }
  assert.ok(r.steps.length >= 4, `1回の実行で4工程以上進んだ：${r.steps}`);
});

test('仕事探し：工程の無い社員は、本当に必要な仕事だけを見つける（納品から24時間たった完成品の価格・販売の再確認）。無ければ理由つきで「仕事なし」', async () => {
  mock = fetchMock();
  slowAndPr(mock, { ms: 5 });
  const kv = memoryKv();
  const old = new Date(Date.now() - 25 * 3600000).toISOString();
  await kv.set('v2:migrate:nocover-1', '2026-11-18'); // 表紙の無い完成品の一度だけの却下（移行）は済んだことにする
  await kv.setJson(V.V2_KEYS.sets, [{ id: 'set1', title: '台所の工夫', status: 'waiting', deliveredAt: old }]);
  await kv.setJson(V.V2_KEYS.set('set1'), { id: 'set1', title: '台所の工夫', status: 'waiting', deliveredAt: old, jobId: 'j0', products: [{ code: 's:x1', name: '道具1', short: '道具1', price: 2000 }, { code: 's:x2', name: '道具2', short: '道具2', price: 2480 }] });
  await kv.incrFloat(`budget:month:${today().slice(0, 7)}`, 999.5); // 新しい案件は始めない（AIの費用の手前）
  const r = await run(kv);
  assert.ok((r.steps || []).includes('auditor:recheck:done'), `監査が完成品の再確認を見つけた：${r.steps}`);
  const s = await kv.getJson(V.V2_KEYS.set('set1'));
  assert.ok(s.recheckedAt, '再確認の日時');
  assert.equal(s.products[0].recheck.status, 'changed', '価格が変わった（2,000円→2,480円）');
  assert.equal(s.products[1].recheck.status, 'same');
  const st = await V.officeState(kv, ENV);
  assert.ok(st.events.some((e) => e.type === 'find' && e.agent === 'auditor' && /仕事探し/.test(e.text)));
  assert.ok(st.notices.some((n) => n.recheck && /2,480円/.test(n.text)), '変わった点を社長に知らせる');
  // 2回目：24時間たっていないので、同じ再確認はしない（仕事をしているふりをしない）
  const r2 = await run(kv);
  assert.ok(!(r2.steps || []).some((x) => x.startsWith('auditor:recheck')), `同じ再確認を繰り返さない：${r2.steps}`);
  const st2 = await V.officeState(kv, ENV);
  const buyer = st2.staff.find((x) => x.id === 'buyer');
  assert.equal(buyer.status, 'idle'); assert.match(buyer.doing, /^仕事なし：/);
  assert.ok(st2.staff.find((x) => x.id === 'auditor').stats.side >= 1, '社員ごとの処理件数');
});

test('広報（常設）：交流候補の投稿にコメント案→監査が採点→社長の承認待ち。送信はしない。1日の上限・同じアカウントの間隔を守る', async () => {
  mock = fetchMock();
  const seen = slowAndPr(mock, { ms: 10 });
  const kv = memoryKv();
  await kv.incrFloat(`budget:month:${today().slice(0, 7)}`, 990); // 案件は始めない（広報だけを見る）
  const E = { ...ENV, __kv: kv };
  const add = (n, handle) => call(v2api, { action: 'prAdd', url: `https://www.instagram.com/p/POST${n}abc/`, caption: `朝の通勤で使っているバッグの中身を紹介します ${n}`, handle }, undefined, E);
  assert.equal((await add(1, 'shop_a')).status, 200);
  assert.equal((await add(2, 'shop_a')).status, 200); // 同じアカウント（7日に1件まで）
  for (const [n, h] of [[3, 'shop_b'], [4, 'shop_c'], [5, 'shop_d']]) await add(n, h);
  assert.equal((await call(v2api, { action: 'prAdd', url: 'https://www.instagram.com/p/POST9abc/', caption: '' }, undefined, E)).status, 400, '投稿の文章が無いものは入れない');
  await kv.del(`budget:month:${today().slice(0, 7)}`); await kv.incrFloat(`budget:month:${today().slice(0, 7)}`, 900);
  for (let i = 0; i < 5; i++) await run(kv, { ...ENV, V2_THEMES: '' });
  const st = await V.officeState(kv, ENV);
  const d = st.pr.drafts;
  assert.ok(d.length >= 1, 'コメント案ができた');
  assert.ok(d.length <= 3, `1日の上限3件：${d.length}件`);
  assert.ok(d.every((x) => x.status === 'approval'), `監査が合格にした案は社長の承認待ち：${d.map((x) => x.status)}`);
  assert.equal(d.filter((x) => x.handle === 'shop_a').length, 1, '同じアカウントには7日に1件');
  assert.ok(st.events.some((e) => e.type === 'handoff' && e.agent === 'pr' && e.to === 'auditor'), '広報→監査の引き継ぎ');
  assert.equal(st.staff.find((x) => x.id === 'pr').status, 'approval', '広報は「承認待ち」');
  assert.equal(seen.instagram, 0, 'Instagramには何も送らない（公式サイトの確認のみ・別のホスト）');
  // 社長：承認 → 送った（社長の申告として記録）
  const id = d[0].id;
  assert.equal((await call(v2api, { action: 'prDecide', id, decision: 'sent' }, undefined, E)).status, 400, '承認の前に「送った」にはできない');
  assert.equal((await call(v2api, { action: 'prDecide', id, decision: 'approve' }, undefined, E)).data.draft.status, 'approved');
  assert.equal((await call(v2api, { action: 'prDecide', id, decision: 'sent' }, undefined, E)).data.draft.status, 'sent');
  const log = await kv.hgetallJson('pr:comment:log');
  assert.equal(Object.values(log)[0].source, 'owner_report', '送った記録は社長の申告（Instagramとは未照合）');
  assert.equal(st.pr.access.sends, false);
});

test('広報：監査で不合格の案は直し、直しても届かなければ送らない（承認待ちにしない）', async () => {
  mock = fetchMock();
  slowAndPr(mock, { ms: 5, prPass: false });
  const kv = memoryKv();
  await kv.incrFloat(`budget:month:${today().slice(0, 7)}`, 900);
  await call(v2api, { action: 'prAdd', url: 'https://www.instagram.com/p/POSTZabc/', caption: '朝の通勤で使っているバッグの中身を紹介します', handle: 'shop_z' }, undefined, { ...ENV, __kv: kv });
  for (let i = 0; i < 6; i++) await run(kv);
  const st = await V.officeState(kv, ENV);
  const d = st.pr.drafts[0];
  assert.equal(d.status, 'dropped', `直しても届かなかった案は送らない：${d.status}`);
  assert.equal(d.revisions, 2);
  assert.equal(st.pr.counts.approval, 0);
});

test('予算：同時に進めても、月の上限を超えない（同時に進めている工程の見込みを足して確かめる）', async () => {
  mock = fetchMock();
  slowAndPr(mock, { ms: 50 });
  const kv = memoryKv();
  await kv.incrFloat(`budget:month:${today().slice(0, 7)}`, 997.2);
  const base = (id, step) => ({ id, kind: 'make', step, createdAt: new Date().toISOString(), attempts: 0, runs: [], wait: null, data: { theme: `企画${id}`, keyword: `企画${id}`, angle: 'classic' } });
  await kv.setJson(V.V2_KEYS.cases, [base('a', 'propose'), base('b', 'find'), base('c', 'find')]);
  for (let i = 0; i < 3; i++) await run(kv);
  const s = await spent(kv);
  assert.ok(s.month <= 1000, `今月 ${s.month}円（上限1,000円）`);
});

test('くまの一言メモ（社長の指摘 2026-11-16）：納品済みの完成品の、説明文の切れ端の一言を、編集が仕事探しで書き直す。体験談・データに無い性能は通さない', async () => {
  mock = fetchMock();
  slowAndPr(mock, { ms: 5 });
  const kv = memoryKv();
  await kv.incrFloat(`budget:month:${today().slice(0, 7)}`, 990); // 新しい案件は始めない
  await kv.setJson('v2:pr:state', { sitesAt: new Date().toISOString(), siteChecks: Object.fromEntries(Object.keys(OFFICIAL_SITES).map((b) => [b, new Date().toISOString()])) });
  const items = [0, 1, 2].map((n) => ({ name: `キッチン 道具${n}`, caption: '水受けトレー付きで、水滴がたれにくい。', price: 1000 + n, role: n ? '代替・比較' : '本命', code: `c${n}` }));
  const raw = { title: '台所の工夫', items, copy: { items: items.map(() => ({ shortName: '道具', subline: '水滴がたれにくい', memo: 'この一台が変えます', factOnly: true })) } };
  await kv.set('v2:migrate:nocover-1', '2026-11-18'); // 表紙の無い完成品の一度だけの却下（移行）は済んだことにする
  await kv.setJson(V.V2_KEYS.sets, [{ id: 'm1', title: '台所の工夫', status: 'waiting', deliveredAt: new Date().toISOString() }]);
  await kv.setJson(V.V2_KEYS.set('m1'), { id: 'm1', title: '台所の工夫', status: 'waiting', deliveredAt: new Date().toISOString(), products: items.map((it) => ({ ...it, short: '道具' })), raw });
  const r = await run(kv);
  assert.ok((r.steps || []).includes('editor:memo:done'), `編集が一言メモの書き直しを見つけた：${r.steps}`);
  const set = await V.getSet(kv, 'm1');
  assert.equal(set.products[0].memo, '水受けトレー付きで、台が濡れにくい。');
  assert.equal(set.products[1].memo, '本命と比べて、違いを見てから選びたい候補。', '体験談は決まった一言に置き換える');
  assert.equal(new Set(set.products.map((p) => p.memo)).size, 3, '同じ一言を並べない');
  assert.ok(!/涼しい/.test(set.products[2].memo), 'データに無い性能は通さない');
  const r2 = await run(kv);
  assert.ok(!(r2.steps || []).some((x) => x.startsWith('editor:memo')), '書き直したものは繰り返さない');
});

// ---- 2026-11-17 OpenAIの残高不足：通常の失敗と分け、残高待ちで保存し、残高が戻ったら続きから ----
function noCredits(m) {
  const inner = globalThis.fetch;
  const st = { on: true, ai: 0 };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('api.openai.com')) {
      st.ai += 1;
      if (st.on) return new Response(JSON.stringify({ error: { message: 'You have no credits remaining. Add credits to continue using the API.', type: 'insufficient_quota', code: 'insufficient_quota' } }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }
    return inner(url, opts);
  };
  const restore = m.restore; m.restore = () => { globalThis.fetch = inner; restore(); };
  return st;
}
test('残高不足：案件を終わらせず「残高待ち」で保存し、失敗の回数に数えない。残高待ちの間はAIを呼ばない。残高が戻ったら1件で確かめて全部を続きから', async () => {
  mock = fetchMock();
  const st = noCredits(mock);
  const kv = memoryKv();
  await kv.setJson('v2:pr:state', { sitesAt: new Date().toISOString() });
  const base = (id, step) => ({ id, kind: 'make', step, createdAt: new Date().toISOString(), attempts: 2, runs: [], wait: null, data: { theme: `企画${id}`, keyword: `企画${id}`, angle: 'classic' } });
  await kv.setJson(V.V2_KEYS.cases, [base('a', 'propose'), base('b', 'find')]);
  await run(kv);
  let cases = await kv.getJson(V.V2_KEYS.cases);
  assert.equal(cases.length, 2, '案件は消えない・終わらない');
  assert.ok(cases.every((c) => c.wait && c.wait.kind === 'quota'), `残高待ち：${JSON.stringify(cases.map((c) => c.wait))}`);
  assert.ok(cases.every((c) => c.attempts === 2), '失敗の回数を増やさない');
  const q = await kv.getJson(V.V2_KEYS.quota);
  assert.ok(q && Date.parse(q.until) > Date.now() + 25 * 60000, '30分後まで試さない');
  const calls1 = st.ai;
  assert.ok(calls1 <= 2, `残高不足が分かったら、ほかのモデル・ほかの案件で呼び続けない：${calls1}回`);
  for (let i = 0; i < 3; i++) await run(kv);
  assert.equal(st.ai, calls1, '残高待ちの間はAIを呼ばない');
  assert.equal((await kv.getJson(V.V2_KEYS.cases)).length, 2, '何回実行しても案件は終わらない');
  const office = await V.officeState(kv, ENV);
  assert.ok(office.quota && office.staff.find((s) => s.id === 'planner').status === 'budget');
  assert.match(office.staff.find((s) => s.id === 'planner').doing, /OpenAIの残高待ち/);
  // 残高が戻った（時刻が来た）：1件で確かめて、通れば全部を続きから
  st.on = false;
  await kv.setJson(V.V2_KEYS.quota, { ...q, until: new Date(Date.now() - 1000).toISOString() });
  const r = await run(kv);
  assert.equal(await kv.getJson(V.V2_KEYS.quota), null, '残高が戻ったら残高待ちを解く');
  cases = await kv.getJson(V.V2_KEYS.cases);
  assert.ok(cases.every((c) => !c.wait || c.wait.kind !== 'quota'), '残高待ちの案件はすべて続きから');
  assert.ok((r.steps || []).length >= 2, `再開して進んだ：${r.steps}`);
});
test('残高不足：前の実行で「再試行待ち」になった残高不足の案件は、失敗の回数を戻して残高待ちに移す。画像の描き直しの回数にも数えない', async () => {
  mock = fetchMock();
  noCredits(mock);
  const kv = memoryKv();
  await kv.setJson('v2:pr:state', { sitesAt: new Date().toISOString() });
  await kv.setJson(V.V2_KEYS.cases, [
    { id: 'x', kind: 'make', step: 'scene', attempts: 2, runs: [], wait: { kind: 'retry', until: new Date(Date.now() + 3600000).toISOString(), why: 'gpt-5.4-nano: OpenAI APIエラー 429 You have no credits remaining.' }, data: { set: { items: [], copy: {} } } },
    { id: 'y', kind: 'make', step: 'image', attempts: 0, runs: [], wait: null, data: { imageRounds: 2, cover: { scene: { usage: '台所で使う', place: 'キッチン', action: '料理の途中で道具を使っている' }, item: { name: 'キッチン 道具', image: 'https://thumbnail.image.rakuten.co.jp/x.jpg' }, tries: 0 }, set: { items: [], copy: {} } } }
  ]);
  await run(kv);
  const cases = await kv.getJson(V.V2_KEYS.cases);
  const x = cases.find((c) => c.id === 'x'); const y = cases.find((c) => c.id === 'y');
  assert.equal(x.wait.kind, 'quota'); assert.equal(x.attempts, 0, '残高不足で増えた失敗の回数を戻す');
  assert.ok(y, '画像の工程の案件も終わらない');
  assert.equal(y.data.imageRounds, 2, '画像の描き直しの回数に数えない');
  assert.equal(y.wait && y.wait.kind, 'quota');
});

// ---- 2026-11-17 有料のAI画像生成を停止：表紙画像なしで完成品まで進め、社長がChatGPTの画像を後から追加する ----
test('AI画像生成の停止（AI_IMAGE_GEN=0）：表紙の無いものは完成品にしないので、文章までそろえて表紙の工程で画像待ちにする（画像APIは呼ばない・消さない）。社長は完成品の表紙を差し替えられる（前の画像は消さない）', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  const env = { ...ENV, AI_IMAGE_GEN: '0', __kv: kv };
  await kv.setJson('v2:pr:state', { sitesAt: new Date().toISOString(), siteChecks: Object.fromEntries(Object.keys((await import('../lib/ig-discovery.js')).OFFICIAL_SITES).map((b) => [b, new Date().toISOString()])) });
  const steps = await untilDelivered(kv, env, 12);
  assert.ok(!steps.some((x) => x.endsWith(':deliver')), `表紙が無いので届けない：${steps.join(' / ')}`);
  assert.equal(mock.calls.images.length, 0, 'OpenAIの画像APIを呼ばない');
  const w = (await kv.getJson(V.V2_KEYS.cases)).find((c) => c.wait && c.wait.kind === 'image');
  assert.ok(w && ['scene', 'image'].includes(w.step), '表紙の工程で画像待ち');
  assert.match(w.wait.why, /完成品にしない/);
  // 社長の画像の差し替え（完成品）
  const set0 = { id: 'set1', title: '既存の完成品', status: 'adopted', products: [], image: { mediaId: 'm0', url: '/api/media?id=m0' } };
  await kv.setJson(V.V2_KEYS.set('set1'), set0); await kv.setJson(V.V2_KEYS.sets, [{ id: 'set1', title: set0.title, status: 'adopted', image: '/api/media?id=m0' }]);
  const jpg = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg').toString('base64');
  const r1 = await call(v2api, { action: 'setImage', id: 'set1', image: jpg }, undefined, env);
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  const saved = await kv.getJson(V.V2_KEYS.set('set1'));
  assert.equal(saved.image.mediaId, r1.data.image.mediaId);
  assert.equal(saved.imageHistory[0].mediaId, 'm0', '前の画像は消さない');
  assert.equal((await call(v2api, { action: 'setImage', id: 'set1', image: 'data:text/plain;base64,AAAA' }, undefined, env)).status, 400);
});
test('AI画像生成の停止：表紙画像の工程にいた案件は、消さずに画像待ちで保存する（仕上げへは進めない）', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  const env = { ...ENV, AI_IMAGE_GEN: '0' };
  await kv.setJson('v2:pr:state', { sitesAt: new Date().toISOString(), siteChecks: Object.fromEntries(Object.keys((await import('../lib/ig-discovery.js')).OFFICIAL_SITES).map((b) => [b, new Date().toISOString()])) });
  const C = await import('../lib/kuma-cover.js');
  const r = await C.imageStep({ kv, env, origin: APP, scene: {}, item: {} });
  assert.match(r.skip, /停止中/, '画像の部品そのものも、画像APIを呼ぶ前に止まる');
  await kv.setJson(V.V2_KEYS.cases, [{ id: 'w', kind: 'make', step: 'image', attempts: 1, runs: [], wait: null, data: { set: { title: '待っていた案件' }, cover: { scene: { place: '机' }, item: {}, tries: 0 } } }]);
  await run(kv, env); await run(kv, env);
  const c = (await kv.getJson(V.V2_KEYS.cases)).find((x) => x.id === 'w');
  assert.ok(c, '消さない'); assert.equal(c.step, 'image'); assert.equal(c.wait.kind, 'image');
  assert.equal((await V.officeState(kv, env)).events.filter((e) => e.job === 'w' && e.type === 'wait').length, 1, '同じ待ちを何度も記録しない');
  assert.equal(mock.calls.images.length, 0);
});

test('表紙が必須（2026-11-18 社長の決定）：社長の確認待ちで表紙の無い完成品は一度だけ却下にし（消さない）、企画の学び（却下の理由）には使わない。表紙のある完成品・採用済みはそのまま', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  const mk = (id, status, image) => ({ id, title: `完成品${id}`, status, products: [], ...(image ? { image: { mediaId: 'm', url: '/api/media?id=m' } } : {}) });
  const sets = [mk('a', 'waiting', false), mk('b', 'waiting', true), mk('c', 'adopted', false), mk('d', 'waiting', false)];
  for (const x of sets) await kv.setJson(V.V2_KEYS.set(x.id), x);
  await kv.setJson(V.V2_KEYS.sets, sets.map((x) => ({ id: x.id, title: x.title, status: x.status, image: x.image ? x.image.url : '' })));
  const hit = await V.rejectNoCover(kv);
  assert.deepEqual(hit, ['a', 'd']);
  const list = await kv.getJson(V.V2_KEYS.sets);
  assert.deepEqual(list.map((x) => x.status), ['rejected', 'waiting', 'adopted', 'rejected']);
  assert.equal((await kv.getJson(V.V2_KEYS.set('a'))).ownerNote, V.NO_COVER_NOTE);
  assert.ok(await kv.getJson(V.V2_KEYS.set('d')), '消さない');
  // 社長が自分で、表紙の無い完成品を却下しても、企画の学びには使わない
  await kv.setJson(V.V2_KEYS.set('e'), mk('e', 'waiting', false)); await kv.setJson(V.V2_KEYS.sets, [...list, { id: 'e', title: '完成品e', status: 'waiting' }]);
  await V.decide(kv, { id: 'e', action: 'reject', note: '表紙なし' });
  assert.ok((await kv.getJson(V.V2_KEYS.sets)).filter((x) => x.status === 'rejected').every((x) => x.noCover));
  // 定期実行では一度だけ動く
  await kv.setJson(V.V2_KEYS.set('f'), mk('f', 'waiting', false)); await kv.setJson(V.V2_KEYS.sets, [...(await kv.getJson(V.V2_KEYS.sets)), { id: 'f', title: '完成品f', status: 'waiting' }]);
  await run(kv); await kv.setJson(V.V2_KEYS.set('g'), mk('g', 'waiting', false)); await kv.setJson(V.V2_KEYS.sets, [...(await kv.getJson(V.V2_KEYS.sets)), { id: 'g', title: '完成品g', status: 'waiting' }]);
  await run(kv);
  const l2 = await kv.getJson(V.V2_KEYS.sets);
  // 先に社長が手で却下した表紙の無いもの（印なし）にも、一度だけ印を付ける（状態は変えない）
  const k2 = memoryKv();
  await k2.setJson(V.V2_KEYS.set('h'), { ...mk('h', 'rejected', false), ownerNote: '' }); await k2.setJson(V.V2_KEYS.set('i'), mk('i', 'rejected', true));
  await k2.setJson(V.V2_KEYS.sets, [{ id: 'h', title: 'h', status: 'rejected' }, { id: 'i', title: 'i', status: 'rejected', image: '/api/media?id=m' }]);
  assert.deepEqual(await V.tagNoCover(k2), ['h']);
  assert.equal((await k2.getJson(V.V2_KEYS.set('h'))).status, 'rejected');
  assert.equal(l2.find((x) => x.id === 'f').status, 'rejected'); assert.equal(l2.find((x) => x.id === 'g').status, 'waiting', '移行は一度だけ（その後は社長が判断）');
});

test('表紙が必須：描けなかったら時間を空けてもう1回だけ描き、それでも描けなければ表紙なしで納品せず止める。仕上げに表紙が無ければデザイナーに戻す', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  const job = { id: 'x', kind: 'make', step: 'pack', attempts: 0, runs: [], wait: null, data: { set: { title: 'T', copy: { caption: 'PR' }, items: [] }, cover: { scene: { place: '机' }, item: {}, tries: 0 } } };
  await kv.setJson(V.V2_KEYS.cases, [job]);
  await run(kv);
  let c = (await kv.getJson(V.V2_KEYS.cases)).find((x) => x.id === 'x');
  assert.ok(!c || c.step !== 'pack' || c.data.packBack === 1, '表紙が無いので仕上げで納品しない');
  assert.ok(!((await kv.getJson(V.V2_KEYS.sets)) || []).length, '完成品にならない');
});
test('残高待ち：手動の実行では時刻を待たずに1件だけ試し、通れば全部を続きから再開する（定期実行は時刻まで待つ）', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  await kv.setJson('v2:pr:state', { sitesAt: new Date().toISOString(), siteChecks: Object.fromEntries(Object.keys((await import('../lib/ig-discovery.js')).OFFICIAL_SITES).map((b) => [b, new Date().toISOString()])) });
  const base = (id) => ({ id, kind: 'make', step: 'propose', createdAt: new Date().toISOString(), attempts: 0, runs: [], wait: { kind: 'quota', why: '残高' }, data: {} });
  await kv.setJson(V.V2_KEYS.cases, [base('a'), base('b')]);
  await kv.setJson(V.V2_KEYS.quota, { since: new Date().toISOString(), until: new Date(Date.now() + 3 * 3600000).toISOString(), tries: 4 });
  const before = mock.calls.openai.length;
  await withUsage(() => V.tick({ kv, env: ENV, origin: APP, startedAt: Date.now(), trigger: 'qstash' }));
  assert.equal(mock.calls.openai.length, before, '定期実行は時刻まで待つ（AIを呼ばない）');
  const r = await withUsage(() => V.tick({ kv, env: ENV, origin: APP, startedAt: Date.now(), trigger: 'workflow_dispatch', probeNow: true }));
  assert.equal(await kv.getJson(V.V2_KEYS.quota), null, '試して通ったので残高待ちを解いた');
  assert.ok((await kv.getJson(V.V2_KEYS.cases)).every((c) => !c.wait || c.wait.kind !== 'quota'), '2件とも続きから');
  assert.ok((r.steps || []).length >= 2, `仕事が進んだ：${r.steps}`);
});

test('表紙画像：1企画1枚（監査の自動の描き直しなし）。描けなくても完成品は届く。社長が作り直しを頼むと次の実行で1枚だけ描き、前の画像は残す（1つの完成品につき3回まで）', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  const env = { ...ENV, __kv: kv };
  const steps = await untilDelivered(kv, env);
  assert.equal(mock.calls.images.length, 1, `画像は1枚だけ：${steps.join(' / ')}`);
  assert.ok(!steps.some((x) => /checkImage/.test(x)), '監査の画像の確認（描き直しにつながる）を通らない');
  let st = await V.officeState(kv, env);
  const id = st.sets[0].id;
  const first = await V.getSet(kv, id);
  assert.ok(first.image && first.image.mediaId, '表紙画像が入って届く');
  assert.equal((await call(v2api, { action: 'regenImage', id }, undefined, env)).status, 200);
  assert.equal((await call(v2api, { action: 'regenImage', id }, undefined, env)).status, 400, '頼んだ作り直しが終わるまでは重ねて頼めない');
  await kv.del('kuma:scenes'); // テストのAIは毎回同じ場面を返すため、場面の重なりの確認を外す（本物のAIは別の場面を出す）
  for (let i = 0; i < 4; i++) { const r = await run(kv, env); if ((r.steps || []).some((x) => x.startsWith('designer:attach'))) break; }
  assert.equal(mock.calls.images.length, 2, '作り直しで1枚だけ');
  const after = await kv.getJson(V.V2_KEYS.set(id));
  assert.notEqual(after.image.mediaId, first.image.mediaId, '新しい画像に差し替わった');
  assert.equal(after.imageHistory[0].mediaId, first.image.mediaId, '前の画像は残す');
  assert.equal(after.regenPending, false);
  st = await V.officeState(kv, env);
  assert.equal(st.sets.filter((x) => x.id === id).length, 1, '完成品は増えない（同じ完成品の画像だけ）');
  await kv.setJson(V.V2_KEYS.set(id), { ...after, regenCount: 3 });
  assert.equal((await call(v2api, { action: 'regenImage', id }, undefined, env)).status, 400, '3回まで');
});
test('AI画像生成の切り替え：未設定・空なら動く（2026-11-17 再開）。AI_IMAGE_GEN=0 のときだけ止まる', async () => {
  const C = await import('../lib/kuma-cover.js');
  assert.equal(C.aiImageEnabled({ AI_IMAGE_GEN: '' }), true);
  assert.equal(C.aiImageEnabled({ AI_IMAGE_GEN: '1' }), true);
  assert.equal(C.aiImageEnabled({ AI_IMAGE_GEN: '0' }), false);
});

// ---- 2026-11-17 確認待ちが上限でも会社を止めない・商品の偏りを直す ----
test('確認待ちが上限（5件）でも会社は止まらない：企画・商品調査・在庫の確認は進み、文章の前で「完成品の枠待ち」として保存。枠が空いたら続きから', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  const env = { ...ENV, __kv: kv };
  await kv.setJson('v2:pr:state', { sitesAt: new Date().toISOString(), siteChecks: Object.fromEntries(Object.keys((await import('../lib/ig-discovery.js')).OFFICIAL_SITES).map((b) => [b, new Date().toISOString()])) });
  await kv.set('v2:migrate:nocover-1', '2026-11-18'); // 表紙の無い完成品の一度だけの却下（移行）は済んだことにする
  await kv.setJson(V.V2_KEYS.sets, [1, 2, 3, 4, 5, 6].map((n) => ({ id: `w${n}`, title: `確認待ち${n}`, status: 'waiting', deliveredAt: new Date().toISOString() })));
  for (const n of [1, 2, 3, 4, 5, 6]) await kv.setJson(V.V2_KEYS.set(`w${n}`), { id: `w${n}`, title: `確認待ち${n}`, status: 'waiting', deliveredAt: new Date().toISOString(), products: [] });
  const steps = [];
  for (let i = 0; i < 3; i++) steps.push(...((await run(kv, env)).steps || []));
  assert.ok(steps.some((x) => x.startsWith('planner:propose')) && steps.some((x) => x.startsWith('buyer:')), `企画とバイヤーは仕事をした：${steps}`);
  assert.ok(!steps.some((x) => /writer:(copy|room)|pack/.test(x)), '完成品の枠が無いので、文章・納品はしない（冒頭の一言など集客の仕事は別）');
  let cases = await kv.getJson(V.V2_KEYS.cases);
  assert.ok(cases.length >= 1 && cases.some((c) => c.wait && c.wait.kind === 'slot' && c.step === 'copy'), `企画と商品をそろえて保存：${JSON.stringify(cases.map((c) => [c.step, c.wait && c.wait.kind]))}`);
  assert.ok(cases.length <= V.MAX_ACTIVE, '保存する企画は上限まで（量産しない）');
  const st = await V.officeState(kv, env);
  assert.ok(st.staff.filter((s) => s.status !== 'idle').length >= 2, '全員が「仕事なし」にはならない');
  assert.ok(st.staff.find((s) => s.id === 'planner').stats.today >= 1 && st.staff.find((s) => s.id === 'buyer').stats.today >= 1, '実際の仕事の数が記録される');
  // 社長が2件を確認した → 枠が1つ空く → 1件だけ文章から続ける
  await call(v2api, { action: 'decide', id: 'w1', decision: 'adopt' }, undefined, env);
  await call(v2api, { action: 'decide', id: 'w2', decision: 'reject', note: 'メガネばかり' }, undefined, env);
  const r = await run(kv, env);
  assert.ok((r.steps || []).some((x) => x.startsWith('writer:copy')), `枠が空いたら文章から：${r.steps}`);
  cases = await kv.getJson(V.V2_KEYS.cases);
  assert.ok(cases.filter((c) => !c.wait || c.wait.kind !== 'slot').length <= 1 + cases.filter((c) => FLOW_BEFORE(c)).length);
});
const FLOW_BEFORE = (c) => V.FLOW.indexOf(c.step) < V.FLOW.indexOf('copy');

test('商品の偏り：直近に眼鏡関連があれば眼鏡関連の企画は弾いて考え直す。ジャンルの候補と、社長の却下コメントを企画とバイヤーに渡す', async () => {
  mock = fetchMock({ themes: ['偏光サングラス ギフト', 'キッチン 時短', 'デスク 収納'] });
  const kv = memoryKv();
  await kv.setJson(V.V2_KEYS.themes, [{ theme: '通勤の眩しさ対策ギフト', keyword: 'サングラス 偏光', at: new Date().toISOString() }]);
  await kv.setJson(V.V2_KEYS.sets, [{ id: 'r1', title: 'メガネ拭きセット', status: 'rejected', deliveredAt: new Date().toISOString() }]);
  await kv.setJson(V.V2_KEYS.set('r1'), { id: 'r1', title: 'メガネ拭きセット', status: 'rejected', ownerNote: 'メガネ関連ばかりで飽きた。生活用品が見たい' });
  await kv.setJson(V.V2_KEYS.cases, [{ id: 'p', kind: 'make', step: 'propose', createdAt: new Date().toISOString(), attempts: 0, runs: [], wait: null, data: {} }]);
  await run(kv);
  const ev = (await V.officeState(kv, ENV)).events;
  assert.ok(ev.some((e) => /眼鏡関連の企画が続いている/.test(e.text)), '眼鏡関連を弾いた');
  const c = (await kv.getJson(V.V2_KEYS.cases)).find((x) => x.id === 'p');
  assert.ok(!/サングラス|メガネ/.test(c.data.theme || ''), `別のジャンルになった：${c.data.theme}`);
  const sent = mock.calls.openai.map((b) => `${b.messages[0].content}\n${typeof b.messages[1].content === 'string' ? b.messages[1].content : ''}`);
  const prop = sent.find((t) => t.includes('はキャラクター（ぬいぐるみ風のくま）の名前') && t.includes('企画担当'));
  assert.ok(prop, 'キャラクター名であることを企画に伝える');
  assert.match(prop, /今回のジャンル（この中から1つ）/);
  assert.match(prop, /社長のコメント：メガネ関連ばかりで飽きた/);
  const hero = sent.find((t) => t.includes('サングラス株式会社」のバイヤー') || t.includes('サングラスくま株式会社」のバイヤー'));
  if (hero) assert.match(hero, /社長の却下コメント/);
  assert.ok(V.heroFilter && V.EYEWEAR_RE.test('偏光 サングラス') && !V.EYEWEAR_RE.test('キッチン タイマー'));
});

test('連鎖の判断：進められる仕事が残っていれば more=true。待つべき案件だけ・何も進まなかったときは false', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  await kv.setJson('v2:pr:state', { sitesAt: new Date().toISOString(), siteChecks: Object.fromEntries(Object.keys((await import('../lib/ig-discovery.js')).OFFICIAL_SITES).map((b) => [b, new Date().toISOString()])) });
  const r1 = await run(kv);
  assert.ok(r1.steps.length >= 1);
  if ((await kv.getJson(V.V2_KEYS.cases)).some((c) => !c.wait)) assert.equal(r1.more, true, '仕事が残っている');
  await kv.setJson(V.V2_KEYS.cases, [{ id: 'q', kind: 'make', step: 'copy', attempts: 0, runs: [], wait: { kind: 'retry', until: new Date(Date.now() + 3600000).toISOString(), why: 'x' }, data: {} }]);
  await kv.incrFloat(`budget:month:${today().slice(0, 7)}`, 999.99);
  const r2 = await run(kv);
  assert.equal(r2.more, false, '待つべき案件だけなら呼ばない');
});

// ---- 2026-11-17 1企画につき最低6点（足りなければ探す範囲を広げる・それでも足りなければ保留） ----
function widenMock(m, { empty = false } = {}) {
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('api.openai.com') && !u.includes('/images/')) {
      const body = JSON.parse(opts.body); const sys = body.messages[0].content;
      if (sys.includes('商品がまだ足りません')) return aiReply({ slots: [{ role: '関連商品', keyword: '保存容器 ガラス' }, { role: '連想商品', keyword: 'キッチンタイマー' }, { role: '変わり種', keyword: '鍋敷き 木製' }, { role: '低価格帯', keyword: 'シリコン ふた' }] });
    }
    if (empty && u.includes('rakuten') && /keyword=(%E4%BF%9D|%E3%82%AD%E3%83%83%E3%83%81%E3%83%B3%E3%82%BF|%E9%8D%8B|%E3%82%B7%E3%83%AA)/.test(u)) return new Response(JSON.stringify({ Items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return inner(url, opts);
  };
  const restore = m.restore; m.restore = () => { globalThis.fetch = inner; restore(); };
}
const it6 = (n, kw = 'キッチン 道具') => ({ code: `s:z${n}`, name: `${kw}${n}`, price: 1000 + n * 500, url: `https://item.rakuten.co.jp/s/z${n}/`, image: 'https://thumbnail.image.rakuten.co.jp/x.jpg', shop: 'ショップ', caption: '水受けトレー付きで、水滴がたれにくい。', reviewCount: 100 });
test('最低6点：選んだ商品が6点に届かなければ、すぐエラーにせず関連・連想・価格帯へ探す範囲を広げて6点以上にする（確認できた商品だけ）', async () => {
  mock = fetchMock();
  widenMock(mock);
  const kv = memoryKv();
  const plan = { title: 'キッチンの工夫', target: '料理する人', adopted: [], slots: [{ role: '本命', keyword: 'キッチン 道具' }] };
  await kv.setJson(V.V2_KEYS.cases, [{ id: 'k', kind: 'make', step: 'pick', attempts: 2, runs: [], wait: null, data: { theme: 'キッチン', plan, source: [], gathered: { fresh: [], missing: [], slotResults: [{ slot: plan.slots[0], candidates: [it6(1), it6(2)] }] } } }]);
  const steps = [];
  for (let i = 0; i < 4; i++) { steps.push(...((await run(kv)).steps || [])); if (steps.some((x) => x.startsWith('writer:'))) break; }
  assert.ok(steps.some((x) => x.startsWith('buyer:widen')), `探す範囲を広げた：${steps}`);
  const c = (await kv.getJson(V.V2_KEYS.cases)).find((x) => x.id === 'k');
  const st = await V.officeState(kv, ENV);
  const items = c ? c.data.set.items : (await V.getSet(kv, st.sets[0].id)).products; // 速いと完成品まで届く
  assert.ok(items.length >= V.V2_MIN_ITEMS, `6点以上：${items.length}点`);
  assert.ok(items.every((it) => it.price > 0 && /^https:\/\/item\.rakuten\.co\.jp\//.test(it.url) && it.image), '価格・販売ページ・画像がある商品だけ');
  assert.equal(new Set(items.map((it) => it.url)).size, items.length, '重複なし');
});
test('最低6点：広げても足りなければ、無関係な商品で埋めずに「保留」（理由と不足数を残す・案件は消さない）', async () => {
  mock = fetchMock();
  widenMock(mock, { empty: true });
  const kv = memoryKv();
  const plan = { title: 'キッチンの工夫', target: '料理する人', adopted: [], slots: [{ role: '本命', keyword: 'キッチン 道具' }] };
  await kv.setJson(V.V2_KEYS.cases, [{ id: 'h', kind: 'make', step: 'pick', attempts: 0, runs: [], wait: null, data: { theme: 'キッチン', plan, source: [], gathered: { fresh: [], missing: [], slotResults: [{ slot: plan.slots[0], candidates: [it6(1), it6(2)] }] } } }]);
  for (let i = 0; i < 5; i++) await run(kv);
  const c = (await kv.getJson(V.V2_KEYS.cases)).find((x) => x.id === 'h');
  assert.ok(c, '案件は消えない');
  assert.equal(c.wait && c.wait.kind, 'hold');
  assert.match(c.wait.why, /6点に\d点足りない/);
  assert.ok(c.data.set.items.length < V.V2_MIN_ITEMS);
  const st = await V.officeState(kv, ENV);
  assert.equal(st.cases.find((x) => x.id === 'h').wait.kind, 'hold', '保留として画面に出る（エラーで止まったとは出さない）');
});

// ---- 2026-11-18 商品の並びの確認（関係の薄い商品・実質的な重複・価格帯の役割名） ----
test('商品の並び：説明できない商品と比較の意図の無い重複を外す。本命は1つで先頭。高価格帯・低価格帯は同じ用途で価格差があるときだけ', () => {
  const mk = (n, name, price) => ({ code: `c${n}`, name, price, url: `https://item.rakuten.co.jp/s/c${n}/`, image: 'x', role: '' });
  const items = [mk(1, '野球 グラブスタンド', 16500), mk(2, 'HARIO V60 オリーブウッドスタンドセット', 13200), mk(3, 'HARIO V60 ドリッパー スタンドセット', 9801), mk(4, 'コーヒースケール', 1998), mk(5, 'ペーパーフィルター', 278), mk(6, 'コーヒー豆 保存缶入り', 4180), mk(7, 'スペシャルティブレンド 200g', 1480)];
  const v = [
    { n: 1, keep: false, why: 'コーヒーとつながらない' },
    { n: 2, keep: true, role: '本命', use: 'ハンドドリップ器具', why: '淹れる時間ごと贈れる' },
    { n: 3, keep: true, dupOf: 2, use: 'ハンドドリップ器具', role: '比較' },
    { n: 4, keep: true, role: '関連商品', use: '計量', why: '湯量と時間を合わせる' },
    { n: 5, keep: true, role: '関連商品', use: 'ろ紙', why: '使い続けるのに必要' },
    { n: 6, keep: true, role: '比較', use: 'コーヒー豆', why: '贈り物の豆', diff: '保存缶入り' },
    { n: 7, keep: true, role: '比較', use: 'コーヒー豆', why: '定番の豆', compare: '' }
  ];
  const r = V.applyCurate(items, v);
  assert.deepEqual(r.dropped.map((x) => x.code), ['c1', 'c3'], '関係の薄い本命と、実質同じセットを外した');
  assert.equal(r.items[0].code, 'c2'); assert.equal(r.items[0].role, '本命');
  assert.match(r.items.find((x) => x.code === 'c6').role, /高価格帯（コーヒー豆の中で）/);
  assert.match(r.items.find((x) => x.code === 'c7').role, /低価格帯（コーヒー豆の中で）/);
  assert.ok(!/価格帯/.test(r.items.find((x) => x.code === 'c4').role), '用途が違う商品は価格だけで比べない');
  // 比較の意図があれば、同じ用途でも残す
  const r2 = V.applyCurate(items.slice(1, 3), [{ n: 1, keep: true, role: '本命', use: 'ドリップ' }, { n: 2, keep: true, dupOf: 1, compare: '同じ型の高級版と廉価版を比べる', use: 'ドリップ', role: '比較' }]);
  assert.equal(r2.items.length, 2);
  assert.match(r2.items[1].role, /低価格帯/);
});

test('既存の企画の見直し（一度だけ）：文章の前で保存していた企画は確かめ直しへ。名指しの完成品は、社長の記録（ROOM登録・画像）と前の版を残したまま見直した版で差し替える', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  const env = { ...ENV, __kv: kv };
  await kv.setJson('v2:pr:state', { sitesAt: new Date().toISOString(), siteChecks: Object.fromEntries(Object.keys((await import('../lib/ig-discovery.js')).OFFICIAL_SITES).map((b) => [b, new Date().toISOString()])) });
  const items = [0, 1, 2, 3, 4, 5].map((n) => ({ code: `s:k${n}`, name: `キッチン 道具${n}`, price: 1000 + n * 300, url: `https://item.rakuten.co.jp/s/k${n}/`, image: 'https://thumbnail.image.rakuten.co.jp/x.jpg', role: '中価格帯', caption: '水受けトレー付きで、水滴がたれにくい。', feature: '水受けトレー付き', why: '台所で' }));
  const raw = { id: 'set-old', title: '絡まらない磁気ケーブル 徹底比較', target: '在宅', items, copy: { caption: 'x #PR', body: 'x', items: items.map(() => ({ shortName: 'x' })) }, roomTexts: items.map(() => ({ intro: 'あ'.repeat(150) })) };
  await kv.setJson(V.V2_KEYS.sets, [{ id: 'set-old', title: raw.title, status: 'waiting', deliveredAt: new Date().toISOString() }]);
  await kv.setJson(V.V2_KEYS.set('set-old'), { id: 'set-old', title: raw.title, status: 'waiting', deliveredAt: new Date().toISOString(), products: items.map((it) => ({ name: it.name, price: it.price, url: it.url, role: it.role })), caption: '前の文章', image: { mediaId: 'a'.repeat(32), url: '/api/media?id=' + 'a'.repeat(32), label: 'AI生成イメージ' }, roomDone: { 's:k0': '2026-11-17T00:00:00Z' }, raw });
  await kv.setJson(V.V2_KEYS.cases, [{ id: 'slot1', kind: 'make', step: 'copy', attempts: 0, runs: [], wait: { kind: 'slot', why: '枠待ち' }, data: { set: { title: '失敗しない大人コーヒーギフト', items } } }]);
  const steps = [];
  for (let i = 0; i < 8; i++) { steps.push(...((await run(kv, env)).steps || [])); if (steps.some((x) => x === 'pr:pack:deliver')) break; }
  assert.ok(steps.filter((x) => x.startsWith('auditor:curate')).length >= 2, `2件とも確かめ直した：${steps}`);
  const s = await kv.getJson(V.V2_KEYS.set('set-old'));
  assert.ok(s.versions && s.versions[0].caption === '前の文章', '前の版を残す');
  assert.equal(s.roomDone['s:k0'], '2026-11-17T00:00:00Z', 'ROOM登録の記録を残す');
  assert.equal(s.image.mediaId, 'a'.repeat(32), '表紙画像を残す（描き直さない）');
  assert.equal((await kv.getJson(V.V2_KEYS.sets)).filter((x) => x.id === 'set-old').length, 1, '見直しで同じ完成品が増えない（同じ完成品を差し替え）');
  const ev = (await V.officeState(kv, env)).events;
  assert.ok(!ev.some((e) => String(e.job || '').startsWith('redo') && e.agent === 'designer'), '見直しでは画像を描かない（今の表紙のまま）');
});
