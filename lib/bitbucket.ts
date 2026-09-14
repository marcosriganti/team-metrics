const BITBUCKET_API = "https://api.bitbucket.org/2.0";

function getConfig() {
  const workspace = process.env.BITBUCKET_WORKSPACE;
  const repo = process.env.BITBUCKET_REPO;
  const token = process.env.BITBUCKET_TOKEN;

  if (!workspace || !repo || !token) {
    throw new Error("Missing Bitbucket environment variables");
  }

  return { workspace, repo, token };
}

function getHeaders(): HeadersInit {
  const { token } = getConfig();
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

export interface BitbucketPR {
  id: number;
  title: string;
  state: string;
  author: {
    uuid: string;
    display_name: string;
  };
  created_on: string;
  updated_on: string;
  merge_commit?: { date: string };
  diffstat?: { lines_added: number; lines_removed: number };
}

export interface BitbucketComment {
  id: number;
  user: {
    uuid: string;
    display_name: string;
  };
  created_on: string;
  content: { raw: string };
}

export interface BitbucketMember {
  user: {
    uuid: string;
    display_name: string;
    email?: string;
  };
}

interface PaginatedResponse<T> {
  values: T[];
  next?: string;
}

async function fetchPaginated<T>(url: string): Promise<PaginatedResponse<T>> {
  const response = await fetch(url, { headers: getHeaders() });
  if (!response.ok) {
    throw new Error(`Bitbucket API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function* fetchPullRequests(since?: string): AsyncGenerator<BitbucketPR> {
  const { workspace, repo } = getConfig();
  let url = `${BITBUCKET_API}/repositories/${workspace}/${repo}/pullrequests?state=ALL&pagelen=50&sort=-updated_on`;

  while (url) {
    const data = await fetchPaginated<BitbucketPR>(url);

    for (const pr of data.values) {
      // Stop if we've reached already-synced data
      if (since && pr.updated_on <= since) {
        return;
      }
      yield pr;
    }

    url = data.next || "";
  }
}

export async function* fetchPrComments(prId: number): AsyncGenerator<BitbucketComment> {
  const { workspace, repo } = getConfig();
  let url = `${BITBUCKET_API}/repositories/${workspace}/${repo}/pullrequests/${prId}/comments?pagelen=100`;

  while (url) {
    const data = await fetchPaginated<BitbucketComment>(url);

    for (const comment of data.values) {
      yield comment;
    }

    url = data.next || "";
  }
}

export async function* fetchWorkspaceMembers(): AsyncGenerator<BitbucketMember> {
  const { workspace } = getConfig();
  let url = `${BITBUCKET_API}/workspaces/${workspace}/members?pagelen=100`;

  while (url) {
    const data = await fetchPaginated<BitbucketMember>(url);

    for (const member of data.values) {
      yield member;
    }

    url = data.next || "";
  }
}

export async function fetchPrDiffstat(
  prId: number
): Promise<{ lines_added: number; lines_removed: number }> {
  const { workspace, repo } = getConfig();
  const url = `${BITBUCKET_API}/repositories/${workspace}/${repo}/pullrequests/${prId}/diffstat`;

  let linesAdded = 0;
  let linesRemoved = 0;
  let nextUrl: string | undefined = url;

  while (nextUrl) {
    const data: PaginatedResponse<{ lines_added: number; lines_removed: number }> = await fetchPaginated<{ lines_added: number; lines_removed: number }>(nextUrl);
    for (const file of data.values) {
      linesAdded += file.lines_added || 0;
      linesRemoved += file.lines_removed || 0;
    }
    nextUrl = data.next;
  }

  return { lines_added: linesAdded, lines_removed: linesRemoved };
}
