// サングラスくま株式会社 2.0（2026-11-15）：7人のAI社員が工程ごとに引き継ぎ、商品・URL・紹介文・画像のそろった投稿セットを社長に届ける。
//   画面の材料は出来事の記録（開始・完成・引き継ぎ・待ち・止まった理由）だけ。点数や技術の記録は社長向けの状態に出さない
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
let setAuditUsers = [];
afterEach(() => { if (mock) mock.restore(); mock = null; setAuditUsers = []; });
const ENV = { OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app', CRON_SECRET: 'sec', APP_PASSCODE: 'pw', __noWait: true };
const ritem = (code, name, price, caption) => ({ itemCode: code, itemName: name, itemPrice: price, itemUrl: `https://item.rakuten.co.jp/s/${code.replace(/\W/g, '')}/`, mediumImageUrls: ['https://thumbnail.image.rakuten.co.jp/x.jpg'], shopName: 'ショップ', itemCaption: caption, reviewCount: 150, reviewAverage: 4.5, affiliateRate: 4 });
const SHOP = [ritem('s:lid', 'ステンレス 鍋蓋スタンド', 1000, '水受けトレー付きで、水滴がたれにくい。'), ritem('s:tong', 'シリコン トング 耐熱', 1200, 'フライパンを傷つけにくいシリコン製。'), ritem('s:guard', '油はねガード 折りたたみ', 1500, '3面で油はねを防ぐ。')];
function fetchMock({ failAi = false } = {}) {
  let setAudits = 0;
  const m = installFetchMock({
    thumbnail: () => imageResponse(),
    rakuten: (url) => json(200, { Items: url.searchParams.get('itemCode') ? SHOP.filter((x) => x.itemCode === url.searchParams.get('itemCode')) : SHOP }),
    openai: (body) => {
      if (failAi) return json(500, { error: { message: 'server error' } });
      const sys = body.messages[0].content;
      const user = body.messages[1].content;
      // 制作ライン：企画担当AI・投稿セット制作AI・監査AI（投稿セット）・制作担当AI
      if (sys.includes('サングラスくま株式会社」のバイヤー')) return aiReply({ ref: 'R1', who: '自炊する社会人', problem: '鍋のふたの置き場所', whyNow: '鍋料理が増える季節' });
      if (sys.includes('Instagram企画担当とバイヤー')) return aiReply({ pattern: 'discovery', title: 'キッチンの置き場所の工夫', target: '料理する人', reason: '置き場所に困る道具を並べる', appeal: '台所が片づく', adopted: [{ id: 0, role: '本命', feature: '水受けトレー付き', why: 'ふたの置き場所' }], slots: [{ role: '中価格帯', keyword: 'キッチン 道具' }, { role: '低価格帯', keyword: 'キッチン 便利' }] });
      if (sys.includes('企画の枠ごとに')) return aiReply({ picks: [{ slot: 0, id: 0, feature: 'シリコン製', why: 'フライパンを傷つけにくい' }, { slot: 1, id: 1, feature: '3面で油はねを防ぐ', why: 'コンロまわり' }] });
      if (sys.includes('投稿文字を作る担当')) return aiReply({ topicSlug: 'kitchen', category: 'キッチン', caption: '台所の置き場所、気づくと散らかりがち。\n\n今回は置き場所に困る道具を3つ並べました。\n\n買う前に見返せるよう、保存しておいてください。', hashtags: ['#キッチン用品'], cover: { title: 'キッチンの置き場所の工夫' }, items: [0, 1, 2].map((id) => ({ id, shortName: ['鍋蓋スタンド', 'シリコントング', '油はねガード'][id], subline: '置き場所が決まる', memo: '台所が片づく' })) });
      if (sys.includes('紹介文を書く担当')) return aiReply({ items: [0, 1, 2].map((id) => ({ id, intro: GOOD_INTRO })) });
      if (sys.includes('監査AIです') && sys.includes('投稿セット（Instagram')) {
        setAudits++;
        setAuditUsers.push(user);
        const sc = (a) => ({ accuracy: { score: a[0] }, compliance: { score: a[1] }, concept: { score: a[2] }, appeal: { score: a[3] }, room: { score: a[4] } });
        return setAudits === 1 ? aiReply({ scores: sc([22, 18, 15, 12, 12]), flags: {}, fixes: [{ target: 'caption', text: '誰のどんな場面かを1文足す' }], proposal: 'revise', summary: '場面が抽象的' })
          : aiReply({ scores: sc([24, 20, 18, 17, 13]), flags: {}, fixes: [], proposal: 'pass', summary: '商品データと一致し、場面も具体的' });
      }
      if (sys.includes('制作担当AIです')) return aiReply({ caption: '料理のたびに、ふたやトングの置き場所に迷う人へ。\n\n今回は置き場所に困る道具を3つ並べました。\n\n買う前に見返せるよう、保存しておいてください。', room: [], giveUp: '' });
      void user;
      if (sys.includes('検索語を決めます')) return aiReply({ keywords: [{ keyword: 'キッチン 便利', why: 'x' }] });
      if (sys.includes('候補を最大6件選びます')) return aiReply({ candidates: [{ ref: 'R1', quotes: ['水受けトレー付き'], reason: '水受けトレー付きで水滴がたれにくい', target: '料理する人', problem: 'ふたの置き場所', roomValue: '1,000円', cautions: '大きさを確認', motive: 'fix', whoBuys: '平日に自炊する社会人', whyNow: '鍋料理が増える季節', vsOthers: 'R2のトングと違い、水受けトレー付き', priceReason: '1,000円で送料はショップで確認', postIdea: 'くまが鍋のふたをスタンドに立てる' }] });
      if (sys.includes('監査AIです') && sys.includes('コメント案を')) return aiReply({ audits: [{ id: 'AAA1', scores: { specific: 23, natural: 21, relevance: 17, distance: 14, compliance: 15 }, flags: {}, fixes: [], proposal: 'pass' }] });
      if (sys.includes('監査AIです')) return aiReply({ audits: [{ id: 'c1', scores: { accuracy: 25, evidence: 22, usefulness: 17, revenue: 13, compliance: 15 }, flags: {}, fixes: [], proposal: 'pass' }] });
      if (sys.includes('表紙画像担当AIです')) return aiReply({ scenes: [{ usage: '鍋のふたを立てて置く', usageQuote: user.includes('水受けトレー付き') ? '水受けトレー付き' : (user.match(/商品の説明：([^。\n]{4,12})/) || [])[1] || '', place: 'キッチン', time: '夕方', action: '料理の途中で鍋のふたをスタンドに立てている', consistency: 'ふたはスタンドの溝に立つ', camera: '斜め上', productPlacement: '手前で大きく', outfit: 'エプロン', mood: '落ち着いた' }] });
      if (sys.includes('品質確認の担当')) return aiReply({ single: true, character: true, sameAsMaster: true, plush3d: true, productLarge: true, productMatches: true, usingProduct: true, consistent: true, noText: true, noLogo: true, handsOk: true, noMedical: true, warmScene: true, topSpace: true, issues: [] });
      if (sys.includes('営業・交流担当AIです')) return aiReply({ drafts: [{ id: 'AAA1', anchor: '水受けトレー付き', comment: '水受けトレー付きなら台が濡れにくそうですね', relevance: 80, relevanceWhy: 'x', follow: 70, followWhy: 'y' }] });
      return aiReply({});
    }
  });
  // 自分のサイトの静的ファイル（マスター画像・方向性の参考画像）は、リポジトリのファイルを返す
  const mocked = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { const u = String(url); if (u.startsWith(APP)) return new Response(fs.readFileSync(new URL('../' + u.slice(APP.length), import.meta.url)), { status: 200, headers: { 'Content-Type': 'image/png' } }); return mocked(url, opts); };
  return m;
}
const APP = 'https://app.test/';
const run = (kv, env = ENV) => withUsage(() => V.tick({ kv, env, origin: APP, startedAt: Date.now(), trigger: 'test' }));
const call = async (handler, body, headers = { 'x-app-passcode': 'pw' }, env = ENV) => { const req = { method: 'POST', url: '/api/x', headers, body }; const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } }; await handler(req, res, env); return { status: res.statusCode, data: JSON.parse(res.body) }; };

test('2.0：バイヤー→監査→企画→バイヤー→ライター→監査→編集→監査→デザイナー→監査→広報 と引き継ぎ、画像つきの完成品を社長に届ける', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  const steps = [];
  for (let i = 0; i < 30; i++) { const r = await run(kv); steps.push(r.worked ? `${r.worked.agent}:${r.worked.step}${r.worked.final ? ':' + r.worked.final : ''}` : r.idle || r.skipped); if (r.worked && r.worked.final === 'deliver') break; }
  assert.deepEqual(steps, ['buyer:find', 'auditor:checkHero', 'planner:plan', 'buyer:gather', 'buyer:pick', 'writer:copy', 'writer:room', 'auditor:auditText', 'editor:edit', 'auditor:auditText', 'designer:scene', 'designer:image', 'auditor:checkImage', 'pr:pack:deliver'], steps.join(' / '));
  const st = await V.officeState(kv, ENV);
  // 出来事の記録：開始・完成・引き継ぎ・届けた（新しい順）
  const ev = [...st.events].reverse();
  assert.equal(ev[0].type, 'start');
  assert.ok(ev.some((e) => e.type === 'handoff' && e.agent === 'buyer' && e.to === 'auditor'), 'バイヤー→監査の引き継ぎ');
  assert.ok(ev.some((e) => e.type === 'handoff' && e.agent === 'auditor' && e.to === 'editor'), '監査→編集の引き継ぎ');
  assert.equal(ev[ev.length - 1].type, 'deliver');
  assert.ok(ev.every((e) => !('dev' in e)), '開発者向けの記録は社長の画面に出さない');
  { const t = JSON.stringify({ events: st.events, staff: st.staff, sets: st.sets }); const m = t.match(/.{60}(点（合格|合格ライン|"total"|"audits").{30}/); assert.ok(!m, `監査の点数を社長向けの状態に出さない：${m && m[0]}`); }
  // 完成品：商品・URL・紹介文・画像
  assert.equal(st.waiting, 1);
  const set = await V.getSet(kv, st.sets[0].id);
  assert.equal(set.products.length, 3);
  assert.ok(set.products.every((p) => /^https:\/\/item\.rakuten\.co\.jp\//.test(p.url) && p.room.length >= 80));
  assert.match(set.caption, /アフィリエイト|PR/);
  assert.match(set.image.url, /^\/api\/media\?id=[0-9a-f]{32}$/); assert.equal(set.image.label, 'AI生成イメージ');
  assert.equal(set.who, '自炊する社会人');
  assert.ok(!('raw' in set) && !('dev' in set));
  // 社員：仕事が終わったら全員待機（働いているふりをしない）。直近の成果が見える
  assert.ok(st.staff.every((s) => s.status === 'idle'));
  assert.match(st.staff.find((s) => s.id === 'pr').last.text, /完成品/);
  // 費用は今までと同じ予算の記録に入る
  assert.ok((await spent(kv)).dayAuto > 0);
});

test('2.0：社長の確認待ちがあっても次の投稿セットを作り続け、3件たまったら新しくは作らない', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  await kv.setJson(V.V2_KEYS.sets, [1, 2].map((n) => ({ id: `s${n}`, title: 't', status: 'waiting' })));
  assert.equal((await run(kv)).worked.step, 'find', '確認待ち2件なら作る');
  await kv.del(V.V2_KEYS.job);
  await kv.setJson(V.V2_KEYS.sets, [1, 2, 3].map((n) => ({ id: `s${n}`, title: 't', status: 'waiting' })));
  const r = await run(kv);
  assert.match(r.idle, /確認待ちの完成品が3件/);
});

test('2.0：画像の予算を使い切ったら「画像待ち」にして止まらず、ほかの仕事に移る。翌日は続きから描く', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  const env = { ...ENV, IMAGE_DAILY_COUNT: '1' };
  await kv.set(`budget:image:count:${new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)}`, '1');
  let r; const seen = [];
  for (let i = 0; i < 14; i++) { r = await run(kv, env); seen.push(r.worked ? `${r.worked.step}${r.worked.final ? ':' + r.worked.final : ''}` : r.idle); if (r.worked && r.worked.final === 'wait') break; }
  const st = await V.officeState(kv, env);
  if (!(r.worked && r.worked.final === 'wait')) { console.log(seen); }
  assert.equal(r.worked.final, 'wait', seen.join(' / '));
  assert.equal(st.imageWait.length, 1);
  assert.equal(st.staff.find((s) => s.id === 'designer').status, 'wait');
  assert.equal(st.events[0].type, 'wait'); assert.match(st.events[0].text, /画像の予算/);
  assert.equal((await run(kv, env)).worked.step, 'find', '画像待ちのあいだも、次の投稿セットに移る');
});

test('2.0：社長の修正依頼は、編集→監査→広報の短い流れで直して届け直す。採用・却下は記録に残る', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  for (let i = 0; i < 30; i++) { const r = await run(kv); if (r.worked && r.worked.final === 'deliver') break; }
  const id = (await V.officeState(kv, ENV)).sets[0].id;
  const E = { ...ENV, __kv: kv };
  assert.equal((await call(v2api, { action: 'decide', id, decision: 'revise' }, undefined, E)).status, 400, '直す所が無い修正依頼は受けない');
  const d = await call(v2api, { action: 'decide', id, decision: 'revise', note: 'もっと短く' }, undefined, E);
  assert.equal(d.data.status, 'fixing');
  const steps = [];
  for (let i = 0; i < 10; i++) { const r = await run(kv); steps.push(r.worked ? r.worked.step : r.idle); if (r.worked && r.worked.final === 'deliver') break; }
  assert.deepEqual(steps.slice(0, 2), ['edit', 'auditText']);
  assert.equal(steps[steps.length - 1], 'pack');
  const s = await V.getSet(kv, id);
  assert.equal(s.status, 'waiting'); assert.equal(s.revisions, 1); assert.equal(s.ownerNote, 'もっと短く');
  await call(v2api, { action: 'decide', id, decision: 'adopt' }, undefined, E);
  const st = await V.officeState(kv, ENV);
  assert.equal(st.sets[0].status, 'adopted');
  assert.ok(st.events.some((e) => e.type === 'owner' && /採用/.test(e.text)));
});

test('2.0：工程の失敗は1回やり直し、2回目で理由を残して止まり、次の仕事へ移る', async () => {
  mock = fetchMock({ failAi: true });
  const kv = memoryKv();
  const r1 = await run(kv); assert.equal(r1.worked.final, undefined);
  const r2 = await run(kv); assert.equal(r2.worked.final, 'stop');
  const st = await V.officeState(kv, ENV);
  assert.equal(st.events[0].type, 'stop'); assert.match(st.events[0].text, /^止まった：/);
  assert.equal(st.job, null);
  assert.ok(!JSON.stringify(st.events).includes('sk-test'), '鍵を記録に出さない');
});

test('2.0：定期実行は社長が切り替えたときだけ2.0を動かす。手動の実行は target=v2 で2.0の動作確認ができる。APIは合言葉が必要', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  const env = { ...ENV, __kv: kv };
  const tick = (body, headers = {}) => withUsage(() => call(worker, { action: 'tick', ...body }, { authorization: 'Bearer sec', 'x-trigger': 'workflow_dispatch', ...headers }, env));
  assert.notEqual((await tick({})).data.company, 'v2', '切り替え前は1.0');
  assert.equal((await tick({ target: 'v2' })).data.company, 'v2', '手動の実行で2.0の動作確認');
  assert.equal((await call(v2api, { action: 'state' }, {}, env)).status, 401);
  assert.equal((await call(v2api, { action: 'activate', on: true }, { 'x-app-passcode': 'pw' }, env)).data.active, true);
  await kv.del('worker:lock');
  assert.equal((await tick({})).data.company, 'v2', '切り替え後は定期実行で2.0');
  await call(v2api, { action: 'activate', on: false }, { 'x-app-passcode': 'pw' }, env);
  await kv.del('worker:lock');
  assert.notEqual((await tick({})).data.company, 'v2', '戻せる');
});
