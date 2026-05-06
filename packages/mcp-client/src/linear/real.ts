// Real Linear transport — calls the Linear GraphQL API directly.
// Auth: Authorization: <LINEAR_API_KEY> (no Bearer prefix; Linear accepts the key bare).
// All methods catch and degrade gracefully; none throw.

import type {
  LinearClient,
  LinearIssue,
  LinearIssueDetail,
  LinearProject,
  LinearProjectSummary,
  LinearProjectUpdate,
} from "./types";

const DEFAULT_PROJECT_STATES = ["backlog", "started"];

const LINEAR_API_URL = "https://api.linear.app/graphql";

// ---------------------------------------------------------------------------
// Raw GraphQL response shapes (private to this module)
// ---------------------------------------------------------------------------

interface RawIssueNode {
  identifier: string;
  title: string;
  priority: number;
  state: { name: string; type: string };
  team: { key: string };
  assignee: { name: string; displayName: string } | null;
  dueDate: string | null;
  updatedAt: string;
  url: string;
}

interface RawProjectResponse {
  project?: {
    id: string;
    name: string;
    state: string;
    health: string;
    progress: number;
    startDate: string | null;
    targetDate: string | null;
    lead: { name: string; displayName: string } | null;
    url: string;
    updatedAt: string;
  } | null;
}

interface RawProjectIssuesResponse {
  issues?: { nodes: RawIssueNode[] };
}

interface RawProjectUpdatesResponse {
  project?: {
    projectUpdates: {
      nodes: Array<{
        createdAt: string;
        body: string;
        health: string;
        user: { displayName: string };
      }>;
    };
  } | null;
}

interface RawIssueDetailResponse {
  issue?: {
    identifier: string;
    title: string;
    description: string | null;
    state: { name: string; type: string };
    assignee: { name: string; displayName: string } | null;
    comments: {
      nodes: Array<{
        body: string;
        createdAt: string;
        user: { displayName: string };
      }>;
    };
    url: string;
    dueDate: string | null;
    updatedAt: string;
  } | null;
}

interface RawSubtasksResponse {
  issue?: {
    children: { nodes: RawIssueNode[] };
  } | null;
}

interface RawProjectSummaryNode {
  id: string;
  slugId: string;
  name: string;
  description: string | null;
  state: string;
  progress: number;
  lead: { name: string } | null;
  members: { nodes: Array<{ name: string }> };
}

interface RawMyProjectsResponse {
  viewer?: { id: string };
  projects?: { nodes: RawProjectSummaryNode[] };
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export class RealLinearTransport implements LinearClient {
  private async gql<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T | null> {
    const apiKey = process.env["LINEAR_API_KEY"];
    if (!apiKey) return null;
    try {
      const res = await fetch(LINEAR_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: apiKey,
        },
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        data?: T;
        errors?: unknown[];
      };
      if (json.errors?.length) return null;
      return json.data ?? null;
    } catch {
      return null;
    }
  }

  async getProject(projectId: string): Promise<LinearProject | null> {
    const data = await this.gql<RawProjectResponse>(
      `query GetProject($projectId: String!) {
        project(id: $projectId) {
          id name state health progress startDate targetDate
          lead { name displayName }
          url updatedAt
        }
      }`,
      { projectId },
    );
    const p = data?.project;
    if (!p) return null;
    // Project.state is a scalar string in Linear's schema; wrap to match interface.
    return {
      id: p.id,
      name: p.name,
      state: { name: p.state, type: p.state },
      health: p.health,
      progress: p.progress,
      startDate: p.startDate,
      targetDate: p.targetDate,
      lead: p.lead,
      url: p.url,
      updatedAt: p.updatedAt,
    };
  }

  async getProjectIssues(projectId: string): Promise<LinearIssue[]> {
    const data = await this.gql<RawProjectIssuesResponse>(
      `query GetProjectIssues($projectId: ID!) {
        issues(filter: {
          project: { id: { eq: $projectId } }
          parent: { null: true }
        }) {
          nodes {
            identifier title priority
            state { name type }
            team { key }
            assignee { name displayName }
            dueDate updatedAt url
          }
        }
      }`,
      { projectId },
    );
    return data?.issues?.nodes ?? [];
  }

  async getProjectUpdates(projectId: string): Promise<LinearProjectUpdate[]> {
    const data = await this.gql<RawProjectUpdatesResponse>(
      `query GetProjectUpdates($projectId: String!) {
        project(id: $projectId) {
          projectUpdates {
            nodes {
              createdAt body health
              user { displayName }
            }
          }
        }
      }`,
      { projectId },
    );
    const nodes = data?.project?.projectUpdates?.nodes ?? [];
    return [...nodes].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async getIssue(identifier: string): Promise<LinearIssueDetail | null> {
    const data = await this.gql<RawIssueDetailResponse>(
      `query GetIssue($identifier: String!) {
        issue(id: $identifier) {
          identifier title description
          state { name type }
          assignee { name displayName }
          comments {
            nodes { body createdAt user { displayName } }
          }
          url dueDate updatedAt
        }
      }`,
      { identifier },
    );
    const issue = data?.issue;
    if (!issue) return null;
    return {
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      state: issue.state,
      assignee: issue.assignee,
      comments: issue.comments.nodes,
      url: issue.url,
      dueDate: issue.dueDate,
      updatedAt: issue.updatedAt,
    };
  }

  async getSubtasks(issueId: string): Promise<LinearIssue[]> {
    const data = await this.gql<RawSubtasksResponse>(
      `query GetSubtasks($issueId: String!) {
        issue(id: $issueId) {
          children {
            nodes {
              identifier title priority
              state { name type }
              team { key }
              assignee { name displayName }
              dueDate updatedAt url
            }
          }
        }
      }`,
      { issueId },
    );
    return data?.issue?.children?.nodes ?? [];
  }

  async listMyProjects(args?: {
    states?: string[];
  }): Promise<LinearProjectSummary[]> {
    const states = args?.states ?? DEFAULT_PROJECT_STATES;
    // Linear has no `viewer.projects` — query the root `projects` field
    // filtered by `members.id` matching the viewer's id, in one round-trip.
    // Empty state list = no filter (UI uses this for "all states").
    const stateFilter =
      states.length > 0 ? `, state: { in: $states }` : "";
    const data = await this.gql<RawMyProjectsResponse>(
      `query ListMyProjects($viewerId: ID!, $states: [String!]) {
        viewer { id }
        projects(
          filter: { members: { id: { eq: $viewerId } }${stateFilter} }
          first: 100
        ) {
          nodes {
            id slugId name description state progress
            lead { name }
            members { nodes { name } }
          }
        }
      }`,
      // Linear evaluates the variable shape ahead of $viewerId being
      // available, so we send the viewer-id query separately first.
      { viewerId: await this.viewerId(), states },
    );
    const nodes = data?.projects?.nodes ?? [];
    return nodes.map((n) => ({
      id: n.id,
      slugId: n.slugId,
      name: n.name,
      description: n.description,
      state: n.state,
      progress: n.progress,
      lead: n.lead,
      members: n.members.nodes,
    }));
  }

  /** Cache the viewer id since it's stable per session. */
  private cachedViewerId: string | null = null;
  private async viewerId(): Promise<string> {
    if (this.cachedViewerId) return this.cachedViewerId;
    const data = await this.gql<{ viewer?: { id: string } }>(
      `query { viewer { id } }`,
      {},
    );
    this.cachedViewerId = data?.viewer?.id ?? "";
    return this.cachedViewerId;
  }
}
