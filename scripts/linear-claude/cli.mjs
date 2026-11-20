#!/usr/bin/env node
// Linear → Claude Code 自動連携（KOT-6）のワークフローから呼ぶ道具。秘密の値は環境変数からだけ読み、表示しない
//   node cli.mjs pick                 … 処理するチケットを1件選び、受付の印（Claude処理中）を付ける。GITHUB_OUTPUT に番号を書く
//   node cli.mjs prompt <指示> <情報>  … 受付済みのチケットから Claude への指示（と、PR用のチケットの情報）を作る
//   node cli.mjs finish               … 結果（RESULT=success|failure）を Linear に書く（ラベル・状態・コメント・PRのリンク）
import { appendFileSync, writeFileSync } from 'node:fs';
import { createClient } from './linear-api.mjs';
import { config, eligibility, pickCandidate, checkLength, branchName, buildPrompt, labelNames, safeText, limitReason } from './lib.mjs';

const env = process.env;
const log = (...a) => console.log(...a);
const ghaError = (m) => console.log(`::error::${String(m).replace(/\r?\n/g, ' ')}`);

function output(obj) {
  const lines = Object.entries(obj).map(([k, v]) => `${k}=${String(v).replace(/\r?\n/g, ' ')}`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, lines.join('\n') + '\n');
  else log(lines.join('\n'));
}

function labelId(meta, name) {
  const l = meta.labels.find((x) => x.name === name);
  if (!l) throw new Error(`Linear にラベル「${name}」が無い（チーム ${meta.key || ''} に作ってください）`);
  return l.id;
}
function stateId(meta, name, type) {
  return (meta.states.find((s) => s.name === name) || meta.states.find((s) => s.type === type))?.id || null;
}

// 同じチケットのPRがもう開いていれば、もう一度は作らない（Linear のラベルに加えた二重の守り）
export async function openPrsFor(identifier, { repo = env.GITHUB_REPOSITORY, token = env.GH_TOKEN, fetchImpl = globalThis.fetch } = {}) {
  if (!repo || !token) return [];
  const prefix = `${branchName(identifier)}-`;
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`GitHub のPR一覧を読めない（HTTP ${res.status}）`);
  const list = await res.json();
  return list.filter((p) => String(p.head?.ref || '').startsWith(prefix)).map((p) => p.html_url);
}

// 自動連携が作った最近のPR（開いている・閉じた両方）。上限の確認に使う
export async function recentPrs({ repo = env.GITHUB_REPOSITORY, token = env.GH_TOKEN, fetchImpl = globalThis.fetch } = {}) {
  if (!repo || !token) throw new Error('GitHub のPRを数えられない（GITHUB_REPOSITORY・GH_TOKEN が無い）');
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/pulls?state=all&sort=created&direction=desc&per_page=100`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`GitHub のPR一覧を読めない（HTTP ${res.status}）`);
  return res.json();
}

export async function pick({ client, cfg, runUrl, runId, only, prs = openPrsFor, recent = recentPrs }) {
  const meta = await client.teamMeta(cfg.team);
  const ids = {
    running: labelId(meta, cfg.runningLabel),
    failed: labelId(meta, cfg.failedLabel),
  };
  labelId(meta, cfg.requestLabel); labelId(meta, cfg.doneLabel); // 全部そろっているかを先に確かめる
  let issues = await client.listCandidates(cfg.team, cfg.requestLabel);
  if (only) issues = issues.filter((i) => i.identifier === only || i.id === only);
  const skipped = issues.filter((i) => !eligibility(i, cfg).ok);
  for (const i of skipped) log(`対象外 ${i.identifier}：${eligibility(i, cfg).reason}`);
  const issue = pickCandidate(issues, cfg);
  if (!issue) { log('処理するチケットは無い'); return null; }
  // 上限（受付の印を付ける前に確かめる。超えていればチケットには触らず、次の実行で改めて確かめる）
  const limit = limitReason(await recent(), cfg);
  if (limit) { log(`::warning::上限のため今回は受け付けない：${limit}`); return null; }
  log(`選んだチケット：${issue.identifier}`);

  // 先に受付の印を付ける（これ以降、ほかの実行は選ばない）
  await client.addLabel(issue.id, ids.running);
  const again = await client.getIssue(issue.id);
  const names = labelNames(again);
  if (!names.includes(cfg.runningLabel) || names.includes(cfg.doneLabel) || names.includes(cfg.failedLabel)) {
    throw new Error(`${issue.identifier} の受付の印を確認できない（ほかの処理と重なった可能性）。何もしない`);
  }

  const reject = async (reason) => {
    await client.removeLabel(issue.id, ids.running);
    await client.addLabel(issue.id, ids.failed);
    await client.comment(issue.id, `🤖 Claude Code の自動処理は、このチケットを処理しませんでした。\n\n理由：${reason}\n\n直したら「Claude失敗」ラベルを外すと、もう一度処理します。\n\n実行の記録：${runUrl}`);
    log(`${issue.identifier} は処理しない：${reason}`);
    return null;
  };
  const len = checkLength(issue, cfg);
  if (!len.ok) return reject(len.reason);
  const existing = await prs(issue.identifier);
  if (existing.length) return reject(`このチケットのPRがもう開いています（${existing.join(' ')}）`);

  const inProgress = stateId(meta, 'In Progress', 'started');
  if (inProgress && again.state?.type !== 'started') await client.setState(issue.id, inProgress);
  await client.comment(issue.id, `🤖 Claude Code（GitHub Actions）が受け付けました。作業ブランチで実装し、npm test のあとPRを作ります（自動ではマージしません）。\n\n実行の記録：${runUrl}`);
  return { issue_id: issue.id, identifier: issue.identifier, branch: branchName(issue.identifier, runId) };
}

export async function prompt({ client, cfg, issueId }) {
  const issue = await client.getIssue(issueId);
  const names = labelNames(issue);
  if (!names.includes(cfg.runningLabel)) throw new Error('受付の印（Claude処理中）が無いチケットは実行しない');
  if (!names.includes(cfg.requestLabel)) throw new Error('承認ラベルが外されたので実行しない');
  if (!cfg.allowedCreators.includes(issue.creator?.id)) throw new Error('作成者が許可リストに無い');
  const len = checkLength(issue, cfg);
  if (!len.ok) throw new Error(len.reason);
  return { text: buildPrompt(issue), meta: { id: issue.id, identifier: issue.identifier, title: issue.title, url: issue.url } };
}

export async function finish({ client, cfg, issueId, result, prUrl, testText, reason, runUrl, waitMs = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const meta = await client.teamMeta(cfg.team);
  const running = labelId(meta, cfg.runningLabel);
  const done = labelId(meta, cfg.doneLabel);
  const failed = labelId(meta, cfg.failedLabel);
  const issue = await client.getIssue(issueId);
  const names = labelNames(issue);
  const ok = result === 'success';
  if (names.includes(cfg.runningLabel)) await client.removeLabel(issueId, running);
  await client.addLabel(issueId, ok ? done : failed);
  if (prUrl) await client.linkUrl(issueId, prUrl, 'GitHub のPR（Claude Code）');
  if (ok) {
    // PRのリンクを付けると、Linear の GitHub 連携の自動化が少し遅れて状態を In Progress に戻すことがある（KOT-7 の E2E で確認）。
    // 待ってから In Review にし、読み直して戻っていればもう一度だけ直す
    const review = stateId(meta, 'In Review', 'started');
    if (review) {
      if (prUrl) await sleep(waitMs);
      await client.setState(issueId, review);
      await sleep(waitMs);
      const now = await client.getIssue(issueId);
      if (now.state?.id !== review) await client.setState(issueId, review);
    }
  }
  const lines = ok
    ? ['🤖 Claude Code がPRを作りました（自動ではマージしません）。', '', `- PR：${prUrl}`, `- ${testText || 'npm test：結果なし'}`, `- 実行の記録：${runUrl}`]
    : ['🤖 Claude Code の自動処理が完了しませんでした。', '', `- 理由：${safeText(reason || '不明', 800)}`, prUrl ? `- 途中のPR（下書き）：${prUrl}` : null, testText ? `- ${testText}` : null, `- 実行の記録：${runUrl}`, '', '直したら「Claude失敗」ラベルを外すと、もう一度処理します。'];
  await client.comment(issueId, lines.filter((x) => x !== null).join('\n'));
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const cfg = config(env);
  const runUrl = env.RUN_URL || '(実行のURLなし)';
  if (!env.LINEAR_API_KEY) {
    if (cmd === 'pick') { log('::notice::Secrets に LINEAR_API_KEY が未設定のため、何もしません'); output({ found: 'false' }); return; }
    throw new Error('LINEAR_API_KEY が未設定');
  }
  const client = createClient({ apiKey: env.LINEAR_API_KEY });
  if (cmd === 'pick') {
    const r = await pick({ client, cfg, runUrl, runId: env.GITHUB_RUN_ID, only: (env.ONLY_ISSUE || '').trim() });
    output(r ? { found: 'true', ...r } : { found: 'false' });
  } else if (cmd === 'prompt') {
    const metaFile = process.argv[4];
    if (!arg || !metaFile) throw new Error('出力先のファイル（指示・チケットの情報）を指定してください');
    const r = await prompt({ client, cfg, issueId: env.ISSUE_ID });
    writeFileSync(arg, r.text);
    writeFileSync(metaFile, JSON.stringify(r.meta));
    log('指示を作った');
  } else if (cmd === 'finish') {
    await finish({ client, cfg, issueId: env.ISSUE_ID, result: env.RESULT, prUrl: env.PR_URL, testText: env.TEST_TEXT, reason: env.REASON, runUrl });
    log(`Linear に結果を書いた（${env.RESULT}）`);
  } else {
    throw new Error(`使い方: cli.mjs pick | prompt <file> | finish`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { ghaError(safeText(e.message, 500)); process.exit(1); });
}
