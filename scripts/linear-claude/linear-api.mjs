// Linear の GraphQL API（KOT-6）：個人のAPIキーで呼ぶ。キーは環境変数 LINEAR_API_KEY だけから読む（表示しない・ファイルに書かない）
// fetch を差し替えられるので、テストではネットワークに出ない
const ENDPOINT = 'https://api.linear.app/graphql';

const ISSUE_FIELDS = `
  id identifier title description url createdAt archivedAt priority
  creator { id name }
  state { id name type }
  team { id key }
  labels { nodes { id name } }
`;

export function createClient({ apiKey, fetchImpl = globalThis.fetch, endpoint = ENDPOINT } = {}) {
  if (!apiKey) throw new Error('LINEAR_API_KEY が未設定');
  async function gql(query, variables = {}) {
    let res;
    try {
      res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: apiKey },
        body: JSON.stringify({ query, variables }),
      });
    } catch (e) {
      throw new Error(`Linear に接続できない: ${e.message}`);
    }
    let data;
    try { data = await res.json(); } catch { data = null; }
    if (res.status === 429) throw new Error('Linear の利用回数の上限（rate limit）に達した。次の実行で続ける');
    if (res.status === 401 || res.status === 403) throw new Error(`Linear の認証に失敗（HTTP ${res.status}）。LINEAR_API_KEY を確認してください`);
    if (!res.ok || !data) throw new Error(`Linear API エラー（HTTP ${res.status}）`);
    if (data.errors?.length) {
      const msg = data.errors.map((e) => e.message).join(' / ').slice(0, 300);
      throw new Error(`Linear API エラー: ${msg}`);
    }
    return data.data;
  }

  return {
    gql,
    // 承認ラベルが付き、完了・取消でないチケット（チームで絞る）。最終的な判断は lib.mjs の eligibility
    async listCandidates(teamKey, requestLabel) {
      const d = await gql(`query($team: String!, $label: String!) {
        issues(first: 50, filter: {
          team: { key: { eq: $team } },
          labels: { some: { name: { eq: $label } } },
          state: { type: { nin: ["completed", "canceled", "duplicate"] } }
        }) { nodes { ${ISSUE_FIELDS} } }
      }`, { team: teamKey, label: requestLabel });
      return d.issues.nodes;
    },
    async getIssue(id) {
      const d = await gql(`query($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`, { id });
      return d.issue;
    },
    async teamMeta(teamKey) {
      const d = await gql(`query($team: String!) {
        teams(filter: { key: { eq: $team } }) { nodes { id key states { nodes { id name type } } labels { nodes { id name } } } }
      }`, { team: teamKey });
      const t = d.teams.nodes[0];
      if (!t) throw new Error(`Linear のチーム ${teamKey} が見つからない`);
      return { id: t.id, key: t.key, states: t.states.nodes, labels: t.labels.nodes };
    },
    async addLabel(issueId, labelId) {
      const d = await gql(`mutation($id: String!, $label: String!) { issueAddLabel(id: $id, labelId: $label) { success } }`, { id: issueId, label: labelId });
      if (!d.issueAddLabel?.success) throw new Error('ラベルを付けられなかった');
    },
    async removeLabel(issueId, labelId) {
      const d = await gql(`mutation($id: String!, $label: String!) { issueRemoveLabel(id: $id, labelId: $label) { success } }`, { id: issueId, label: labelId });
      if (!d.issueRemoveLabel?.success) throw new Error('ラベルを外せなかった');
    },
    async setState(issueId, stateId) {
      const d = await gql(`mutation($id: String!, $state: String!) { issueUpdate(id: $id, input: { stateId: $state }) { success } }`, { id: issueId, state: stateId });
      if (!d.issueUpdate?.success) throw new Error('状態を変えられなかった');
    },
    async comment(issueId, body) {
      const d = await gql(`mutation($id: String!, $body: String!) { commentCreate(input: { issueId: $id, body: $body }) { success } }`, { id: issueId, body });
      if (!d.commentCreate?.success) throw new Error('コメントを書けなかった');
    },
    async linkUrl(issueId, url, title) {
      const d = await gql(`mutation($id: String!, $url: String!, $title: String!) { attachmentLinkURL(issueId: $id, url: $url, title: $title) { success } }`, { id: issueId, url, title });
      if (!d.attachmentLinkURL?.success) throw new Error('リンクを付けられなかった');
    },
  };
}
