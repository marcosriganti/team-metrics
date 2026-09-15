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

  // Validate project key format (no spaces allowed)
  if (projectKey && projectKey.includes(" ")) {
    logError("WARNING: JIRA_PROJECT_KEY contains spaces. Project keys should be like 'PROJ' or 'BIGORDER', not 'BIG ORDER'");
  }

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
    "Content-Type": "application/json",
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
  log("Fetching:", url, options.method || "GET");
  if (options.body) {
    log("Request body:", options.body);
  }

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
    if (response.status === 410) {
      throw new Error(
        `JIRA API Deprecated (410): The API endpoint has been removed.\n` +
        `This should not happen - please report this bug.\n` +
        `Response: ${body.slice(0, 300)}`
      );
    }

    throw new Error(`JIRA API error: ${response.status} ${response.statusText} - ${body.slice(0, 200)}`);
  }

  return response;
}

// New JIRA search API (POST /rest/api/3/search/jql)
// See: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-jql-post
export async function* fetchIssues(since?: string): AsyncGenerator<JiraIssue> {
  const { projectKey } = getConfig();
  const baseUrl = getBaseUrl();

  // Quote project key in case it contains special chars (though it shouldn't have spaces)
  let jql = `project = "${projectKey}" ORDER BY updated DESC`;
  if (since) {
    const sinceDate = since.split("T")[0];
    jql = `project = "${projectKey}" AND updated >= "${sinceDate}" ORDER BY updated DESC`;
  }

  log("Fetching issues with JQL:", jql);

  let nextPageToken: string | undefined;
  const maxResults = 50;

  while (true) {
    // Use new POST /search/jql endpoint
    const url = `${baseUrl}/search/jql`;
    const body = {
      jql,
      maxResults,
      fields: ["issuetype", "assignee", "summary", "status", "customfield_10016", "created", "resolutiondate"],
      ...(nextPageToken ? { nextPageToken } : {}),
    };

    const response = await fetchWithLogging(url, {
      method: "POST",
      body: JSON.stringify(body),
    });

    const data = await response.json();
    const issues: JiraIssue[] = data.issues || [];

    log("Fetched issues:", { count: issues.length, total: data.total, nextPageToken: data.nextPageToken });

    if (issues.length === 0) {
      break;
    }

    for (const issue of issues) {
      yield issue;
    }

    // Use cursor-based pagination
    if (data.nextPageToken) {
      nextPageToken = data.nextPageToken;
    } else {
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
    const entries: JiraChangelogEntry[] = data.values || [];

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

  if (endpoint.includes("search/jql")) {
    // POST endpoint
    return `curl -X POST -H "Authorization: Basic ${auth}" -H "Content-Type: application/json" -H "Accept: application/json" -d '{"jql":"project = \\"${projectKey}\\"","maxResults":5,"fields":["summary","status"]}' "${url}"`;
  }

  return `curl -H "Authorization: Basic ${auth}" -H "Accept: application/json" "${url}"`;
}
