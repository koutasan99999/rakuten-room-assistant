import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import companyApi from '../server/company.js';
import { TOOL_CATALOG } from '../lib/tool-catalog.js';
import { installFetchMock, aiReply } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', OPENAI_API_KEY: 'sk-test' };
let mock;
afterEach(() => mock && mock.restore());
async function call(body) {
  const req = { method: 'POST', headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await companyApi(req, res, ENV);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}
const FACTS = [{ id: 'F1', area: 'sets', text: '投稿セット：全3件（採用1）' }, { id: 'F2', area: 'instagram', text: 'Instagramに公開した記録：0件' }, { id: 'F3', area: 'activity', text: '11/4 10:00 投稿セットを制作' }];
const TASKS = [{ id: 't1', title: '画像の改善', assignee: 'designer', priority: 'high', due: '2026-11-05', doneWhen: '改善版を提出', status: 'doing' }];

test('経営会議：事実の番号を渡し、根拠のない提言・問題、記録のない「しました」、知らない業務の更新・完了扱いを落とす', async () => {
  let user = '';
  mock = installFetchMock({ openai: (body) => { user = body.messages[1].content; return aiReply({
    summary: '公開が0件', statements: [{ role: 'sns', text: '公開の記録が0件です', facts: ['F2'] }, { role: 'sns', text: '二人目のSNS', facts: [] }, { role: 'buyer', text: 'コメントしました', facts: ['F1'] }, { role: 'designer', text: '投稿セットを制作しました', facts: ['F3'] }, { role: 'nobody', text: 'x' }],
    issues: [{ title: '公開がない', cause: '記録0件', facts: ['F2', 'F9'], owner: 'sns' }, { title: '根拠なし', cause: 'x', facts: [] }],
    proposals: [{ role: 'sns', title: '社長、公開を確認できていません', facts: ['F1', 'F2'], impact: '効果を測れない', request: '投稿URLを記録してください', kind: 'confirm' }, { role: 'ceo', title: '根拠のない批判', facts: ['F99'], impact: 'x', request: 'y' }, { role: 'ceo', title: '影響なし', facts: ['F1'], impact: '', request: 'y' }],
    taskUpdates: [{ id: 't1', note: '改善案を作成中', status: 'done' }, { id: 'tX', note: '知らない業務', status: 'doing' }],
    newTasks: [{ title: 'ROOM登録の確認', assignee: 'sales', priority: 'high', dueDays: 2, doneWhen: '登録状況を記録' }, { title: '担当なし', assignee: 'x', dueDays: 1, doneWhen: 'y' }],
    plan: ['表紙を作り直す'], improvements: [{ problem: '見出しが似ている', idea: '切り口を変える' }]
  }); } });
  const r = await call({ action: 'meeting', date: '2026-11-04', facts: FACTS, tasks: TASKS, ownerNotes: [{ at: 'x', text: '画像が微妙', about: '会議室' }] });
  assert.equal(r.status, 200);
  const m = r.data.meeting;
  assert.ok(user.includes('F2（instagram）: Instagramに公開した記録：0件') && user.includes('画像が微妙') && user.includes('t1: 画像の改善'), user);
  assert.deepEqual(m.statements.map((s) => s.role), ['sns', 'designer']); // 記録のない「コメントしました」は落とし、記録（activity）がある「制作しました」は残す
  assert.deepEqual(m.issues.map((i) => [i.title, i.facts]), [['公開がない', ['F2']]]);
  assert.deepEqual(m.proposals.map((p) => p.title), ['社長、公開を確認できていません']);
  assert.deepEqual(m.taskUpdates, [{ id: 't1', note: '改善案を作成中', status: '' }]); // 完了にはできない
  assert.deepEqual(m.newTasks, [{ title: 'ROOM登録の確認', assignee: 'sales', priority: 'high', due: '2026-11-06', doneWhen: '登録状況を記録' }]);
});

test('会議室の返信：社員の応答と業務を作る。改善案：観点ごとの評価・切り口の重ならない見出し・ツールの料金は確認済みの一覧から', async () => {
  mock = installFetchMock({ openai: (body) => {
    const sys = body.messages[0].content;
    if (sys.includes('社長が会議室で返信しました')) return aiReply({ messages: [{ role: 'designer', text: '承知しました。改善案を出します' }, { role: 'ceo', text: 'デザイナーに割り当てます' }], newTasks: [{ title: '画像の改善案', assignee: 'designer', priority: 'high', dueDays: 2, doneWhen: '改善版を提出' }] });
    return aiReply({ summary: 's', diagnosis: ['表紙で興味を引けるか', 'キャッチコピーが毎回似ていないか', '商品が十分に大きく見えるか', '商品画像の品質', '存在しない観点'].map((point) => ({ point, score: 9, finding: 'f' })), changes: ['見出しを変える'],
      copyVariants: [{ angle: '価格比較', title: 'A' }, { angle: '価格比較', title: 'B' }, { angle: 'なんとなく', title: 'C' }, { angle: '意外性', title: '神アイテム' }, { angle: '問題提起', title: 'D' }],
      coverStyle: 'starter_set', tool: { id: 'canva_manual', problem: 'p', expected: 'e', alternative: 'a', cost: '無料で全部できる' }, nextStep: 'n' });
  } });
  const r = await call({ action: 'reply', message: '画像が微妙だから改善してほしい', about: { title: '公開の確認' }, tasks: [], date: '2026-11-04' });
  assert.equal(r.data.status, 'ok');
  assert.equal(r.data.newTasks[0].assignee, 'designer');
  assert.equal(r.data.newTasks[0].due, '2026-11-06');
  const w = await call({ action: 'work', task: { id: 't1', title: '画像の改善案', assignee: 'designer', doneWhen: '改善版を提出', status: 'doing' }, sets: [{ title: '大人の小物', items: 4 }] });
  const d = w.data.deliverable;
  assert.equal(d.type, 'design');
  assert.equal(d.diagnosis.length, 4);
  assert.ok(d.diagnosis.every((x) => x.score === 5));
  assert.deepEqual(d.copyVariants.map((v) => v.angle + v.title), ['価格比較A', '問題提起D']);
  assert.equal(d.coverStyle, 'trend_pick'); // 小さく並べる型は使わない
  const canva = TOOL_CATALOG.find((t) => t.id === 'canva_manual');
  assert.equal(d.tool.cost, canva.cost); // AIの書いた料金ではなく、確認済みの一覧の内容
  assert.ok(d.tool.api.includes('Enterprise'));
});

test('失敗は200のstatus:errorで返す（自動のやり直しでAIの料金を二重にしない）', async () => {
  mock = installFetchMock({ openai: () => aiReply({ nothing: true }) });
  const r = await call({ action: 'meeting', date: '2026-11-04', facts: FACTS, tasks: [] });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'error');
  const e = await call({ action: 'meeting', facts: [] });
  assert.equal(e.data.status, 'error');
});
