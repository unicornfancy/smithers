// Public types for the Linear GraphQL client.

export interface LinearProject {
  id: string;
  name: string;
  state: { name: string; type: string };
  health: string;
  progress: number;
  startDate: string | null;
  targetDate: string | null;
  lead: { name: string; displayName: string } | null;
  url: string;
  updatedAt: string;
}

export interface LinearIssue {
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

export interface LinearProjectUpdate {
  createdAt: string;
  body: string;
  health: string;
  user: { displayName: string };
}

export interface LinearIssueDetail {
  identifier: string;
  title: string;
  description: string | null;
  state: { name: string; type: string };
  assignee: { name: string; displayName: string } | null;
  comments: Array<{
    body: string;
    createdAt: string;
    user: { displayName: string };
  }>;
  url: string;
  dueDate: string | null;
  updatedAt: string;
}

/** Lightweight project shape used by the onboarding picker. */
export interface LinearProjectSummary {
  id: string;
  slugId: string;
  name: string;
  description: string | null;
  state: string;
  progress: number;
  lead: { name: string } | null;
  members: Array<{ name: string }>;
}

export interface LinearClient {
  getProject(projectId: string): Promise<LinearProject | null>;
  getProjectIssues(projectId: string): Promise<LinearIssue[]>;
  getProjectUpdates(projectId: string): Promise<LinearProjectUpdate[]>;
  getIssue(identifier: string): Promise<LinearIssueDetail | null>;
  getSubtasks(issueId: string): Promise<LinearIssue[]>;
  /** Projects where the viewer is lead or a member; defaults to active states. */
  listMyProjects(args?: {
    states?: string[];
  }): Promise<LinearProjectSummary[]>;
  /**
   * Resolve a Linear URL (issue or project) into a flattened text block
   * for use as draft-agent context. Returns null when the URL doesn't
   * parse or the upstream call fails. Supports:
   *   - https://linear.app/<workspace>/issue/<TEAM>-<NUM>[/<slug>]
   *   - https://linear.app/<workspace>/project/<slug-with-id>
   */
  resolveLinearUrl(url: string): Promise<{
    type: "linear-issue" | "linear-project";
    label: string;
    body: string;
  } | null>;
}
