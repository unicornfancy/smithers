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
    // Linear quirk: when the supplied identifier doesn't exist, the API
    // silently returns SOME other issue (looks like fallback/fuzzy match).
    // Guard against this by confirming the returned identifier matches
    // what we asked for — case-insensitive because Linear identifiers are
    // typically uppercase but URLs might lower them.
    if (
      identifier.includes("-") &&
      issue.identifier.toUpperCase() !== identifier.toUpperCase()
    ) {
      return null;
    }
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

  async resolveLinearUrl(url: string): Promise<{
    type: "linear-issue" | "linear-project";
    label: string;
    body: string;
  } | null> {
    const parsed = parseLinearUrlForContext(url);
    if (!parsed) return null;

    if (parsed.kind === "issue") {
      const issue = await this.getIssue(parsed.identifier);
      if (!issue) return null;
      const lines: string[] = [`# ${issue.identifier} — ${issue.title}`];
      lines.push(
        `state: ${issue.state.name} · assignee: ${issue.assignee?.displayName ?? "unassigned"}`,
      );
      if (issue.description?.trim()) lines.push(issue.description.trim());
      for (const c of issue.comments) {
        const who = c.user.displayName;
        lines.push(`${who}: ${c.body.trim()}`);
      }
      return {
        type: "linear-issue",
        label: `${issue.identifier} — ${issue.title}`,
        body: lines.join("\n\n"),
      };
    }

    // Project resolution.
    const project = await this.getProject(parsed.idOrSlug);
    if (!project) return null;
    const updates = await this.getProjectUpdates(parsed.idOrSlug).catch(
      () => [] as Awaited<ReturnType<typeof this.getProjectUpdates>>,
    );
    const lines: string[] = [`# ${project.name}`];
    lines.push(
      `state: ${project.state.name} · health: ${project.health} · progress: ${Math.round(project.progress * 100)}%`,
    );
    if (project.targetDate) lines.push(`target: ${project.targetDate}`);
    for (const u of updates.slice(0, 5)) {
      lines.push(
        `${u.user.displayName} (${u.createdAt.slice(0, 10)}, ${u.health}): ${u.body.trim()}`,
      );
    }
    return {
      type: "linear-project",
      label: `Linear project — ${project.name}`,
      body: lines.join("\n\n"),
    };
  }
}

/**
 * Parse a Linear URL into a structured ref the resolver can dispatch on.
 * Issue URLs carry an identifier like "T51-42"; project URLs carry a
 * slug-with-id where the trailing hex segment is what the API accepts as
 * the project id.
 */
function parseLinearUrlForContext(
  url: string,
):
  | { kind: "issue"; identifier: string }
  | { kind: "project"; idOrSlug: string }
  | null {
  const trimmed = url.trim();
  const issueMatch = /^https?:\/\/linear\.app\/[^/]+\/issue\/([A-Z0-9]+-\d+)/i.exec(
    trimmed,
  );
  if (issueMatch) {
    return { kind: "issue", identifier: issueMatch[1]!.toUpperCase() };
  }
  const projectMatch = /^https?:\/\/linear\.app\/[^/]+\/project\/([^/?#]+)/i.exec(
    trimmed,
  );
  if (projectMatch) {
    const slug = decodeURIComponent(projectMatch[1]!);
    // Linear API accepts the trailing short id; pull it off if present.
    const idMatch = /-([a-f0-9]{8,})$/i.exec(slug);
    return { kind: "project", idOrSlug: idMatch ? idMatch[1]! : slug };
  }
  return null;
}
