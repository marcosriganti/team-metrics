function getConfig() {
  const host = process.env.JIRA_HOST;
  const projectKey = process.env.JIRA_PROJECT_KEY;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;

  if (!host || !projectKey || !email || !token) {
    throw new Error("Missing JIRA environment variables");
  }

  return { host, projectKey, email, token };
}

function getHeaders(): HeadersInit {
  const { email, token } = getConfig();
  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  return {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
  };
}

function getBaseUrl(): string {
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

export async function* fetchIssues(since?: string): AsyncGenerator<JiraIssue> {
  const { projectKey } = getConfig();
  const baseUrl = getBaseUrl();

  let jql = `project = ${projectKey} ORDER BY updated DESC`;
  if (since) {
    const sinceDate = since.split("T")[0];
    jql = `project = ${projectKey} AND updated >= "${sinceDate}" ORDER BY updated DESC`;
  }

  let startAt = 0;
  const maxResults = 50;

  while (true) {
    const url = `${baseUrl}/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=${maxResults}&fields=issuetype,assignee,summary,status,customfield_10016,created,resolutiondate`;

    const response = await fetch(url, { headers: getHeaders() });
    if (!response.ok) {
      throw new Error(`JIRA API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const issues: JiraIssue[] = data.issues;

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

    const response = await fetch(url, { headers: getHeaders() });
    if (!response.ok) {
      throw new Error(`JIRA API error: ${response.status} ${response.statusText}`);
    }

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

  const response = await fetch(url, { headers: getHeaders() });
  if (!response.ok) {
    throw new Error(`JIRA API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const statuses = new Set<string>();

  for (const issueType of data) {
    for (const status of issueType.statuses) {
      statuses.add(status.name);
    }
  }

  return Array.from(statuses).sort();
}
