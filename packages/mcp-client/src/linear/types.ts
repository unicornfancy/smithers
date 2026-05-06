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

export interface LinearClient {
  getProject(projectId: string): Promise<LinearProject | null>;
  getProjectIssues(projectId: string): Promise<LinearIssue[]>;
  getProjectUpdates(projectId: string): Promise<LinearProjectUpdate[]>;
  getIssue(identifier: string): Promise<LinearIssueDetail | null>;
  getSubtasks(issueId: string): Promise<LinearIssue[]>;
}
