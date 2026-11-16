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
  const mine = steps.filter((x) => !x.includes('propose') || steps.indexOf(x) === 0);
  const order = ['planner:propose', 'buyer:find', 'auditor:checkHero', 'planner:plan', 'buyer:gather', 'buyer:pick', 'writer:copy', 'writer:room', 'auditor:auditText', 'editor:edit', 'auditor:auditText', 'editor:review', 'designer:scene', 'designer:image', 'auditor:checkImage', 'pr:pack:deliver'];
  let k = 0; for (const s of mine) if (s === order[k]) k++;
  assert.equal(k, order.length, `工程の順番：${steps.join(' / ')}`);
  const st = await V.officeState(kv, ENV);
  const ev = [...st.events].reverse();
  assert.match(ev.find((e) => e.type === 'start').text, /社長の指示を待たずに、新しい案件を始めた/);
  assert.match(ev[0].text, /14日間の試験運用を始めた/);
  assert.ok(ev.some((e) => e.type === 'handoff' && e.agent === 'auditor' && e.to === 'editor'), '監査→編集への差し戻し');
  assert.ok(ev.some((e) => e.type === 'handoff' && e.agent === 'editor' && e.to === 'designer'), '編集→デザイナー');
  assert.ok(ev.some((e) => e.type === 'handoff' && e.agent === 'auditor' && e.to === 'pr'), '監査→広報');
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

test('実証3：一つの案件が画像待ちでも、別の案件が進む（並行）。各社員は1回の実行で決まった工程数まで', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  await kv.incrFloat(`budget:image:yen:${today()}`, 500); // 今日の画像の目安は使い切り
  await kv.setJson(V.V2_KEYS.trial, { start: new Date(Date.now() - 20 * 86400000).toISOString(), end: new Date(Date.now() - 6 * 86400000).toISOString(), cap: 1000, base: { month: today().slice(0, 7), spent: 0 } }); // 試験運用のあと（通常の上限）
  const env = { ...ENV, IMAGE_DAILY_COUNT: '1' };
  let waited = false; const jobsAfter = new Set();
  for (let i = 0; i < 14; i++) {
    const r = await run(kv, env);
    if ((r.steps || []).some((x) => x.endsWith(':wait'))) { waited = true; (r.jobs || []).forEach((j) => jobsAfter.add(`w:${j}`)); continue; }
    if (waited) (r.jobs || []).forEach((j) => jobsAfter.add(j));
    const count = {}; (r.steps || []).forEach((x) => { const a = x.split(':')[0]; count[a] = (count[a] || 0) + 1; });
    assert.ok(Object.values(count).every((n) => n <= V.AGENT_PER_TICK), `1人の社員が1回で${V.AGENT_PER_TICK}工程まで：${r.steps}`);
  }
  assert.ok(waited, '画像待ちになった');
  const st = await V.officeState(kv, env);
  const waiting = st.cases.filter((c) => c.wait && c.wait.kind === 'image');
  const moving = st.cases.filter((c) => !c.wait);
  assert.ok(waiting.length >= 1, '画像待ちの案件がある');
  assert.ok(jobsAfter.size >= 1 && [...jobsAfter].some((id) => !waiting.find((w) => w.id === id)), '画像待ちのあいだも別の案件が進んだ');
  assert.equal(st.staff.find((s) => s.id === 'designer').status, moving.some((c) => c.agent === 'designer') ? 'queued' : 'wait');
  assert.ok(st.cases.length <= V.MAX_ACTIVE + V.MAX_IMAGE_WAIT, '案件を抱えすぎない');
  // 翌日（画像の予算が戻る）：画像待ちの案件が自動で続きから進む
  await kv.del(`budget:image:yen:${today()}`);
  const r = await run(kv, env);
  assert.ok((r.steps || []).includes('designer:image'), `画像の予算が戻ったら描く：${r.steps}`);
});

test('実証4：完成したら、社長の操作なしに次の案件が自動で始まる。同じ企画は繰り返さない', async () => {
  mock = fetchMock({ themes: ['キッチン収納', 'キッチン収納', '鍋まわり', 'コンロ掃除'] });
  const kv = memoryKv();
  await untilDelivered(kv);
  const r = await run(kv);
  const st = await V.officeState(kv, ENV);
  assert.ok(st.cases.length >= 1, '次の案件がある');
  assert.ok(st.events.some((e) => e.type === 'start' && /指示を待たずに/.test(e.text) && e.at >= st.sets[0].deliveredAt), '完成のあとに新しい案件が自動で始まった');
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
  const fix = steps.filter((x) => /editor:edit|auditor:auditText|editor:review|pr:pack/.test(x));
  assert.deepEqual(fix.slice(0, 4), ['editor:edit', 'auditor:auditText', 'editor:review', 'pr:pack:deliver'], steps.join(' / '));
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
  assert.ok(cs.find((c) => c.id === 'old2'));
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
  await run(kv);
  st = await V.officeState(kv, ENV);
  assert.ok(st.cases.some((c) => c.wait && c.wait.kind === 'budget' && /試験運用の上限/.test(c.wait.why)), '試験の上限で予算待ち');
});

test('画像以外ができた制作物は「画像待ちの制作物」として社長が見られる。選定理由と価格帯が完成品に入る', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  await kv.incrFloat(`budget:image:yen:${today()}`, 500);
  for (let i = 0; i < 14; i++) { const r = await run(kv); if ((r.steps || []).some((x) => x.endsWith(':wait'))) break; }
  const st = await V.officeState(kv, ENV);
  assert.ok(st.drafts.length >= 1, '画像待ちの制作物');
  assert.ok(st.drafts[0].caption && st.drafts[0].products.length >= 3);
  await kv.del(`budget:image:yen:${today()}`);
  for (let i = 0; i < 6; i++) { const r = await run(kv); if ((r.steps || []).some((x) => x.endsWith(':deliver'))) break; }
  const s = await V.getSet(kv, (await V.officeState(kv, ENV)).sets[0].id);
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
