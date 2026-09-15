const BITBUCKET_API = "https://api.bitbucket.org/2.0";

// Debug mode - logs all API calls and responses
const DEBUG = process.env.NODE_ENV === "development" || process.env.DEBUG === "true";

function log(...args: unknown[]) {
  if (DEBUG) {
    console.log("[Bitbucket]", ...args);
  }
}

function logError(...args: unknown[]) {
  console.error("[Bitbucket ERROR]", ...args);
}

export function getConfig() {
  const workspace = process.env.BITBUCKET_WORKSPACE;
  const repo = process.env.BITBUCKET_REPO;
  const token = process.env.BITBUCKET_TOKEN;
  const username = process.env.BITBUCKET_USERNAME;

  log("Config check:", {
    workspace: workspace ? `"${workspace}"` : "MISSING",
    repo: repo ? `"${repo}"` : "MISSING",
    token: token ? `"${token.slice(0, 4)}..."` : "MISSING",
    username: username ? `"${username}"` : "MISSING (optional for App Password)",
  });

  if (!workspace || !repo || !token) {
    const missing = [];
    if (!workspace) missing.push("BITBUCKET_WORKSPACE");
    if (!repo) missing.push("BITBUCKET_REPO");
    if (!token) missing.push("BITBUCKET_TOKEN");
    throw new Error(`Missing Bitbucket environment variables: ${missing.join(", ")}`);
  }

  return { workspace, repo, token, username };
}

function getHeaders(): HeadersInit {
  const { token, username } = getConfig();

  // Detect token type based on format
  // - App Passwords: typically alphanumeric, ~20 chars, use with username via Basic Auth
  // - Repository Access Tokens: start with certain prefixes, use Bearer
  // - OAuth tokens: JWT format, use Bearer

  const looksLikeJwt = token.includes(".") && token.length > 100;
  const hasUsername = !!username;

  if (hasUsername) {
    // App Password flow: username + app_password via Basic Auth
    const auth = Buffer.from(`${username}:${token}`).toString("base64");
    log("Using Basic Auth (App Password) with username:", username);
    return {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    };
  } else if (looksLikeJwt) {
    // OAuth/JWT token
    log("Using Bearer token (looks like JWT/OAuth)");
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
  } else {
    // Repository Access Token or App Password without username
    // Try Bearer first (for Repo Access Tokens)
    log("Using Bearer token (Repository Access Token)");
    log("Token preview:", token.slice(0, 8) + "...");
    log("If you get 401, try setting BITBUCKET_USERNAME for App Password auth");
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
  }
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
  log("Fetching:", url);

  const headers = getHeaders();
  const response = await fetch(url, { headers });

  log("Response status:", response.status, response.statusText);

  if (!response.ok) {
    const body = await response.text();
    logError("API Error Response:", {
      status: response.status,
      statusText: response.statusText,
      body: body.slice(0, 500),
      url,
    });

    // Provide helpful error messages
    if (response.status === 401) {
      throw new Error(
        `Bitbucket Auth Failed (401): Check your credentials.\n` +
        `- If using App Password: Set both BITBUCKET_USERNAME and BITBUCKET_TOKEN\n` +
        `- If using Repository Access Token: Set only BITBUCKET_TOKEN\n` +
        `Response: ${body.slice(0, 200)}`
      );
    }
    if (response.status === 403) {
      throw new Error(
        `Bitbucket Forbidden (403): Token lacks required permissions.\n` +
        `Required scopes: repository:read, pullrequest:read\n` +
        `Response: ${body.slice(0, 200)}`
      );
    }
    if (response.status === 404) {
      throw new Error(
        `Bitbucket Not Found (404): Check workspace/repo names.\n` +
        `Workspace: ${process.env.BITBUCKET_WORKSPACE}\n` +
        `Repo: ${process.env.BITBUCKET_REPO}\n` +
        `Response: ${body.slice(0, 200)}`
      );
    }

    throw new Error(`Bitbucket API error: ${response.status} ${response.statusText} - ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  log("Response data:", { valuesCount: data.values?.length, hasNext: !!data.next });
  return data;
}

export async function* fetchPullRequests(since?: string): AsyncGenerator<BitbucketPR> {
  const { workspace, repo } = getConfig();
  let url = `${BITBUCKET_API}/repositories/${workspace}/${repo}/pullrequests?state=ALL&pagelen=50&sort=-updated_on`;

  log("Fetching PRs since:", since || "beginning");

  while (url) {
    const data = await fetchPaginated<BitbucketPR>(url);

    for (const pr of data.values) {
      if (since && pr.updated_on <= since) {
        log("Reached already-synced data, stopping");
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

  log("Fetching workspace members");

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

// Helper to generate curl command for testing
export function getCurlCommand(endpoint: string): string {
  const { workspace, repo, token, username } = getConfig();
  const url = `${BITBUCKET_API}${endpoint}`
    .replace("{workspace}", workspace)
    .replace("{repo}", repo);

  if (username) {
    return `curl -u "${username}:${token}" "${url}"`;
  } else {
    return `curl -H "Authorization: Bearer ${token}" "${url}"`;
  }
}
