// Debug mode - logs all API calls and responses
const DEBUG = process.env.NODE_ENV === "development" || process.env.DEBUG === "true";

function log(...args: unknown[]) {
  if (DEBUG) {
    console.log("[JIRA]", ...args);
  }
}

function logError(...args: unknown[]) {
  console.error("[JIRA ERROR]", ...args);
}

export function getConfig() {
  const host = process.env.JIRA_HOST;
  const projectKey = process.env.JIRA_PROJECT_KEY;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;

  log("Config check:", {
    host: host ? `"${host}"` : "MISSING",
    projectKey: projectKey ? `"${projectKey}"` : "MISSING",
    email: email ? `"${email}"` : "MISSING",
    token: token ? `"${token.slice(0, 4)}..."` : "MISSING",
  });

  if (!host || !projectKey || !email || !token) {
    const missing = [];
    if (!host) missing.push("JIRA_HOST");
    if (!projectKey) missing.push("JIRA_PROJECT_KEY");
    if (!email) missing.push("JIRA_EMAIL");
    if (!token) missing.push("JIRA_API_TOKEN");
    throw new Error(`Missing JIRA environment variables: ${missing.join(", ")}`);
  }

  return { host, projectKey, email, token };
}

function getHeaders(): HeadersInit {
  const { email, token } = getConfig();
  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  log("Using Basic Auth with email:", email);
  return {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
  };
}

export function getBaseUrl(): string {
  const { host } = getConfig();
  return `https://${host}/rest/api/3`;
}

export interface JiraIssue {
  key: string;
  fields: {
    issuetype: { name: string };
    assignee: { accountId: string; displayName: string } | null;
    summary: string;
    status: { name: string };
    customfield_10016?: number; // Story points - field ID may vary
    created: string;
    resolutiondate: string | null;
  };
}

export interface JiraChangelogEntry {
  id: string;
  author: { accountId: string } | null;
  created: string;
  items: Array<{
    field: string;
    fromString: string | null;
    toString: string | null;
  }>;
}

async function fetchWithLogging(url: string, options: RequestInit = {}): Promise<Response> {
  log("Fetching:", url);

  const response = await fetch(url, {
    ...options,
    headers: { ...getHeaders(), ...options.headers },
  });

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
        `JIRA Auth Failed (401): Check your credentials.\n` +
        `- JIRA_EMAIL should be your Atlassian account email\n` +
        `- JIRA_API_TOKEN should be created at https://id.atlassian.com/manage-profile/security/api-tokens\n` +
        `Response: ${body.slice(0, 200)}`
      );
    }
    if (response.status === 403) {
      throw new Error(
        `JIRA Forbidden (403): Your account may lack project access.\n` +
        `Project: ${process.env.JIRA_PROJECT_KEY}\n` +
        `Response: ${body.slice(0, 200)}`
      );
    }
    if (response.status === 404) {
      throw new Error(
        `JIRA Not Found (404): Check host and project key.\n` +
        `Host: ${process.env.JIRA_HOST}\n` +
        `Project: ${process.env.JIRA_PROJECT_KEY}\n` +
        `Response: ${body.slice(0, 200)}`
      );
    }

    throw new Error(`JIRA API error: ${response.status} ${response.statusText} - ${body.slice(0, 200)}`);
  }

  return response;
}

export async function* fetchIssues(since?: string): AsyncGenerator<JiraIssue> {
  const { projectKey } = getConfig();
  const baseUrl = getBaseUrl();

  let jql = `project = ${projectKey} ORDER BY updated DESC`;
  if (since) {
    const sinceDate = since.split("T")[0];
    jql = `project = ${projectKey} AND updated >= "${sinceDate}" ORDER BY updated DESC`;
  }

  log("Fetching issues with JQL:", jql);

  let startAt = 0;
  const maxResults = 50;

  while (true) {
    const url = `${baseUrl}/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=${maxResults}&fields=issuetype,assignee,summary,status,customfield_10016,created,resolutiondate`;

    const response = await fetchWithLogging(url);
    const data = await response.json();
    const issues: JiraIssue[] = data.issues;

    log("Fetched issues:", { count: issues.length, total: data.total, startAt });

    if (issues.length === 0) {
      break;
    }

    for (const issue of issues) {
      yield issue;
    }

    startAt += maxResults;
    if (startAt >= data.total) {
      break;
    }
  }
}

export async function* fetchIssueChangelog(
  issueKey: string
): AsyncGenerator<JiraChangelogEntry> {
  const baseUrl = getBaseUrl();
  let startAt = 0;
  const maxResults = 100;

  while (true) {
    const url = `${baseUrl}/issue/${issueKey}/changelog?startAt=${startAt}&maxResults=${maxResults}`;

    const response = await fetchWithLogging(url);
    const data = await response.json();
    const entries: JiraChangelogEntry[] = data.values;

    if (entries.length === 0) {
      break;
    }

    for (const entry of entries) {
      yield entry;
    }

    startAt += maxResults;
    if (startAt >= data.total) {
      break;
    }
  }
}

export async function fetchProjectStatuses(): Promise<string[]> {
  const { projectKey } = getConfig();
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/project/${projectKey}/statuses`;

  log("Fetching project statuses for:", projectKey);

  const response = await fetchWithLogging(url);
  const data = await response.json();
  const statuses = new Set<string>();

  for (const issueType of data) {
    for (const status of issueType.statuses) {
      statuses.add(status.name);
    }
  }

  log("Found statuses:", Array.from(statuses));
  return Array.from(statuses).sort();
}

// Helper to generate curl command for testing
export function getCurlCommand(endpoint: string): string {
  const { host, email, token, projectKey } = getConfig();
  const baseUrl = `https://${host}/rest/api/3`;
  const url = `${baseUrl}${endpoint}`.replace("{projectKey}", projectKey);
  const auth = Buffer.from(`${email}:${token}`).toString("base64");

  return `curl -H "Authorization: Basic ${auth}" -H "Accept: application/json" "${url}"`;
}
