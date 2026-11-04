// 自律経営のAPI：meeting（毎日の経営会議）／reply（社長の返信から社員の応答と業務を作る）／work（担当社員の作業：改善案・作業計画）。
// 画面が1日1回・社長の返信のときだけ呼ぶ（会議のために何度もAIを呼ばない）。
// 失敗は 200 の status:'error' で返す（検索ジョブの自動やり直しで、AIの料金が二重にかからないように）。
import { send, checkAccess, readBody } from '../lib/http.js';
import { meeting, reply, work, readMeetingInput, readTasks, readFacts, readWorkInput } from '../lib/company.js';
import { maskSecrets } from '../lib/ai.js';

const str = (v, n) => String(v == null ? '' : v).slice(0, n);

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;
  const body = await readBody(req);
  const action = str(body.action, 20);
  try {
    if (action === 'meeting') return send(res, 200, { status: 'ok', meeting: await meeting({ input: readMeetingInput(body), env, deadline: startedAt + 50000 }) });
    if (action === 'reply') {
      const message = str(body.message, 400).trim();
      if (!message) return send(res, 400, { error: '返信がありません' });
      const about = body.about && typeof body.about === 'object' ? { title: str(body.about.title, 80), text: str(body.about.text, 160), role: str(body.about.role, 12) } : null;
      return send(res, 200, { status: 'ok', ...(await reply({ message, about, tasks: readTasks(body.tasks), facts: readFacts(body.facts), date: str(body.date, 10), env, deadline: startedAt + 45000 })) });
    }
    if (action === 'work') return send(res, 200, { status: 'ok', deliverable: await work({ input: readWorkInput(body), env, deadline: startedAt + 50000 }) });
    return send(res, 400, { error: '操作が分かりません' });
  } catch (e) {
    return send(res, 200, { status: 'error', error: maskSecrets(e.message).slice(0, 300) });
  }
}
