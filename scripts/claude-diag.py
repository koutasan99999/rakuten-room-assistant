# Claude Code の実行結果（JSON）から、エラーの内容だけを安全に表示する（2026-11-19）
# - 認証情報らしき文字列（sk-ant-…・長いトークン風の文字列）は伏せ字にする。トークンの値は読まない・表示しない
import json, re, sys
REDACT = [re.compile(r'sk-ant-[A-Za-z0-9_\-]+'), re.compile(r'[A-Za-z0-9_\-]{40,}'), re.compile(r'(?i)(bearer|token|authorization)["\s:=]+[^\s",}]+')]
def clean(s):
    s = str(s)
    for r in REDACT: s = r.sub('[伏せ字]', s)
    return s[:600]
def main(path, label):
    try:
        raw = open(path, encoding='utf-8', errors='replace').read()
    except OSError:
        print(f'[{label}] 結果のファイルが無い'); return
    items = []
    try:
        d = json.loads(raw); items = d if isinstance(d, list) else [d]
    except ValueError:
        for line in raw.splitlines():
            try: items.append(json.loads(line))
            except ValueError: pass
    res = [x for x in items if isinstance(x, dict) and x.get('type') == 'result']
    if not res:
        print(f'[{label}] result が無い。先頭：{clean(raw[:400])}'); return
    r = res[-1]
    print(f"[{label}] is_error={r.get('is_error')} subtype={r.get('subtype')} turns={r.get('num_turns')} 費用(USD)={r.get('total_cost_usd')}")
    print(f"[{label}] 内容：{clean(r.get('result', ''))}")
    for k in ('errors', 'api_error_status', 'error'):
        if r.get(k): print(f'[{label}] {k}：{clean(r.get(k))}')
    for x in items:
        if isinstance(x, dict) and x.get('type') == 'assistant':
            m = x.get('message') or {}
            for c in m.get('content') or []:
                if isinstance(c, dict) and c.get('type') == 'text': print(f'[{label}] 応答：{clean(c.get("text", ""))[:200]}')
if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else '')
