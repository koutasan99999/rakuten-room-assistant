import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync, readFileSync } from 'node:fs';

// 経営会議には、経営監査役の監査（99-executive-audit.txt）が必ず入る（社長の決定 2026-11-02）。
// 経営監査役を置く前の会議だけは対象外。
const BEFORE_AUDITOR = new Set(['2026-10-30-first-100', '2026-10-30-buyer-1', '2026-10-30-policy', '2026-10-31-reach-to-room', '2026-11-02-first-buyer', '2026-11-02-discovery']);
const DIR = new URL('../docs/ai-team/meetings/', import.meta.url);

test('経営監査役の定義があり、会議の手順に組み込まれている', () => {
  const agent = readFileSync(new URL('../.claude/agents/executive-auditor.md', import.meta.url), 'utf8');
  assert.match(agent, /^---\nname: executive-auditor\n/);
  for (const k of ['承認推奨', '条件付き承認', '差し戻し推奨', '中止推奨']) assert.ok(agent.includes(k), k);
  assert.match(readFileSync(new URL('../docs/ai-team/README.md', import.meta.url), 'utf8'), /第4ラウンド（必須）：経営監査役/);
});

test('経営会議の記録には、経営監査役の監査報告がある', () => {
  for (const name of readdirSync(DIR)) {
    if (BEFORE_AUDITOR.has(name) || !existsSync(new URL(`${name}/00-report.txt`, DIR))) continue;
    const audit = new URL(`${name}/99-executive-audit.txt`, DIR);
    assert.ok(existsSync(audit), `${name} に経営監査役の監査報告（99-executive-audit.txt）がない`);
    assert.match(readFileSync(audit, 'utf8'), /総合判定：(承認推奨|条件付き承認|差し戻し推奨|中止推奨)/, `${name} の監査報告に総合判定がない`);
  }
});
