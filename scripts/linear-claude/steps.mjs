#!/usr/bin/env node
// Linear → Claude Code 自動連携（KOT-6）：ワークフローの各段階の小さな処理（ネットワークに触らない）
//   node steps.mjs claude-result <claude.json> <summary.md>   … Claude の結果を読む。GITHUB_ENV 用の行（CLAUDE_OK=…）を出す
//   node steps.mjs redact-file <file>                          … エラー出力を伏せ字つきで短く表示
//   node steps.mjs check-changes <changed.txt>                 … 変更してはいけないファイルが無いか
//   node steps.mjs test-result <test.log> <終了コード>         … npm test の件数。GITHUB_ENV 用の行（TEST_OK・TEST_TEXT）を出す
//   node steps.mjs commit-message <issue.json>
//   node steps.mjs pr-text <issue.json> <summary.md> <title出力> <body出力>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { forbiddenPaths, parseTestSummary, testLine, prTitle, prBody, safeText, redact } from './lib.mjs';

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const oneLine = (s) => String(s).replace(/[\r\n]+/g, ' ').slice(0, 400);

// claude -p --output-format json の結果（1つのJSON。行ごとのJSONでも読む）
export function readClaudeResult(raw) {
  let items = [];
  try { const d = JSON.parse(raw); items = Array.isArray(d) ? d : [d]; } catch {
    for (const line of String(raw).split('\n')) { try { items.push(JSON.parse(line)); } catch { /* 読めない行は飛ばす */ } }
  }
  const r = items.filter((x) => x && x.type === 'result').pop();
  if (!r) return { ok: false, summary: '', error: '結果が無い（Claude Code が起動できなかった可能性）' };
  const ok = r.is_error === false && r.subtype === 'success';
  const error = ok ? '' : `${r.subtype || 'error'}${r.result ? '：' + r.result : ''}`;
  return { ok, summary: String(r.result || ''), error, turns: r.num_turns };
}

export function commitMessage(issue) {
  return `${prTitle(issue)}\n\nLinear: ${issue.url}\nClaude Code（GitHub Actions・linear-claude.yml）が実装。自動ではマージしない\n`;
}

function main() {
  const [cmd, ...a] = process.argv.slice(2);
  if (cmd === 'claude-result') {
    const r = readClaudeResult(read(a[0]));
    writeFileSync(a[1], r.summary);
    console.error(`Claude：${r.ok ? '成功' : '失敗'}${r.turns != null ? `（${r.turns}回のやりとり）` : ''}`);
    if (!r.ok) console.error(`内容：${safeText(r.error, 600)}`);
    console.log(`CLAUDE_OK=${r.ok}`);
    if (!r.ok) console.log(`CLAUDE_ERROR=${oneLine(redact(r.error))}`);
  } else if (cmd === 'redact-file') {
    const t = read(a[0]);
    if (t.trim()) console.log(`stderr：${safeText(t, 600)}`);
  } else if (cmd === 'check-changes') {
    const paths = read(a[0]).split('\n').map((s) => s.trim()).filter(Boolean);
    const bad = forbiddenPaths(paths);
    if (bad.length) { console.log(`::error::変更してはいけないファイル：${bad.join(', ')}`); process.exit(1); }
    console.log(`変更 ${paths.length} 件（問題なし）`);
  } else if (cmd === 'test-result') {
    const code = Number(a[1]);
    const t = parseTestSummary(read(a[0]));
    const ok = code === 0 && t.found && t.fail === 0;
    console.log(`TEST_OK=${ok}`);
    console.log(`TEST_TEXT=${oneLine(testLine(t, code))}`);
  } else if (cmd === 'commit-message') {
    process.stdout.write(commitMessage(JSON.parse(read(a[0]))));
  } else if (cmd === 'pr-text') {
    const issue = JSON.parse(read(a[0]));
    writeFileSync(a[2], prTitle(issue));
    writeFileSync(a[3], prBody({
      issue,
      runUrl: process.env.RUN_URL || '',
      testText: process.env.TEST_TEXT || 'npm test：結果なし',
      summary: read(a[1]),
      branch: process.env.BRANCH || '',
    }));
  } else {
    console.error('使い方: steps.mjs claude-result | check-changes | test-result | commit-message | pr-text');
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
