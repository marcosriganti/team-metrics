import { NextResponse } from "next/server";
import { getConfig as getBitbucketConfig, getCurlCommand as getBitbucketCurl } from "@/lib/bitbucket";
import { getConfig as getJiraConfig, getCurlCommand as getJiraCurl, getBaseUrl as getJiraBaseUrl } from "@/lib/jira";

export async function GET() {
  const debug: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV,
    debugMode: process.env.DEBUG === "true" || process.env.NODE_ENV === "development",
  };

  // Check Bitbucket config
  try {
    const bbConfig = getBitbucketConfig();
    debug.bitbucket = {
      status: "configured",
      workspace: bbConfig.workspace,
      repo: bbConfig.repo,
      authMethod: bbConfig.username ? "App Password (Basic Auth)" : "Bearer Token",
      username: bbConfig.username || "(not set - using Bearer)",
      tokenPreview: bbConfig.token.slice(0, 4) + "...",
    };
    debug.bitbucketCurlExamples = {
      listPRs: getBitbucketCurl("/repositories/{workspace}/{repo}/pullrequests?state=ALL&pagelen=5"),
      workspaceMembers: getBitbucketCurl("/workspaces/{workspace}/members?pagelen=5"),
      testAuth: getBitbucketCurl("/user"),
    };
  } catch (error) {
    debug.bitbucket = {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
    debug.bitbucketCurlExamples = null;
  }

  // Check JIRA config
  try {
    const jiraConfig = getJiraConfig();
    debug.jira = {
      status: "configured",
      host: jiraConfig.host,
      projectKey: jiraConfig.projectKey,
      email: jiraConfig.email,
      tokenPreview: jiraConfig.token.slice(0, 4) + "...",
      baseUrl: getJiraBaseUrl(),
    };
    debug.jiraCurlExamples = {
      myself: getJiraCurl("/myself"),
      searchIssues: getJiraCurl(`/search?jql=project=${jiraConfig.projectKey}&maxResults=5`),
      projectStatuses: getJiraCurl("/project/{projectKey}/statuses"),
    };
  } catch (error) {
    debug.jira = {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
    debug.jiraCurlExamples = null;
  }

  // Environment variables check (without exposing values)
  debug.envVarsPresent = {
    BITBUCKET_WORKSPACE: !!process.env.BITBUCKET_WORKSPACE,
    BITBUCKET_REPO: !!process.env.BITBUCKET_REPO,
    BITBUCKET_TOKEN: !!process.env.BITBUCKET_TOKEN,
    BITBUCKET_USERNAME: !!process.env.BITBUCKET_USERNAME,
    JIRA_HOST: !!process.env.JIRA_HOST,
    JIRA_PROJECT_KEY: !!process.env.JIRA_PROJECT_KEY,
    JIRA_EMAIL: !!process.env.JIRA_EMAIL,
    JIRA_API_TOKEN: !!process.env.JIRA_API_TOKEN,
  };

  debug.instructions = {
    message: "Copy the curl commands above and run them in your terminal to test the APIs directly.",
    bitbucketAppPassword: {
      step1: "Go to Bitbucket Settings > Personal settings > App passwords",
      step2: "Create with scopes: repository:read, pullrequest:read",
      step3: "Set BITBUCKET_USERNAME=your-username and BITBUCKET_TOKEN=the-app-password",
    },
    jiraApiToken: {
      step1: "Go to https://id.atlassian.com/manage-profile/security/api-tokens",
      step2: "Create API token",
      step3: "Set JIRA_EMAIL=your-email and JIRA_API_TOKEN=the-token",
    },
  };

  return NextResponse.json(debug, {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
