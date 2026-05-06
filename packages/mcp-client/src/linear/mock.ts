// Mock Linear transport — canned data for the seed vault.
// Uses The Pocket NYC Phase 2 as the reference project.

import type {
  LinearClient,
  LinearIssue,
  LinearIssueDetail,
  LinearProject,
  LinearProjectUpdate,
} from "./types";

const MOCK_PROJECT: LinearProject = {
  id: "48fe0eb7-6c45-435f-be92-3faa87a21418",
  name: "The Pocket NYC Phase 2",
  state: { name: "started", type: "started" },
  health: "onTrack",
  progress: 3,
  startDate: "2026-02-17",
  targetDate: "2026-05-19",
  lead: { name: "Katie McCanna", displayName: "katie.mccanna" },
  url: "https://linear.app/a8c/project/the-pocket-nyc-phase-2-8ca0b5d6870e",
  updatedAt: "2026-04-17T23:04:27.279Z",
};

const MOCK_PHASE_ISSUES: LinearIssue[] = [
  {
    identifier: "DSG51-436",
    title: "The Pocket NYC | Phase 2 Design",
    priority: 0,
    state: { name: "In Progress", type: "started" },
    team: { key: "DSG51" },
    assignee: { name: "Anders Norén", displayName: "andersnoren" },
    dueDate: null,
    updatedAt: "2026-04-30T16:04:02.623Z",
    url: "https://linear.app/a8c/issue/DSG51-436/the-pocket-nyc-or-phase-2-design",
  },
  {
    identifier: "T51LAUN-2760",
    title: "Development",
    priority: 0,
    state: { name: "Todo", type: "unstarted" },
    team: { key: "T51LAUN" },
    assignee: null,
    dueDate: null,
    updatedAt: "2026-02-10T21:24:36.654Z",
    url: "https://linear.app/a8c/issue/T51LAUN-2760/development",
  },
  {
    identifier: "T51LAUN-2763",
    title: "Launch",
    priority: 0,
    state: { name: "Todo", type: "unstarted" },
    team: { key: "T51LAUN" },
    assignee: null,
    dueDate: null,
    updatedAt: "2026-02-10T21:24:36.654Z",
    url: "https://linear.app/a8c/issue/T51LAUN-2763/launch",
  },
];

const MOCK_PROJECT_UPDATES: LinearProjectUpdate[] = [
  {
    createdAt: "2026-04-27T22:01:04.095Z",
    body: "The partner is eagerly awaiting the Phase 2 designs from @andersnoren that should be moving toward completion this week.",
    health: "onTrack",
    user: { displayName: "katie.mccanna" },
  },
  {
    createdAt: "2026-04-11T03:57:12.646Z",
    body: "Pablo, @andersnoren @christy.nyiri and I connected this week to discuss the Phase 2 designs. The partner is increasingly eager for the ticket display improvements.",
    health: "onTrack",
    user: { displayName: "katie.mccanna" },
  },
  {
    createdAt: "2026-03-27T20:33:23.803Z",
    body: "Anders should have initial designs for phase 2 to share with us next week, meanwhile we're moving forward with a few post-launch requests from the partner.",
    health: "onTrack",
    user: { displayName: "katie.mccanna" },
  },
];

const MOCK_DESIGN_ISSUE_DETAIL: LinearIssueDetail = {
  identifier: "DSG51-436",
  title: "The Pocket NYC | Phase 2 Design",
  description:
    "Revisit the event pages to accommodate partner-requested changes: expanded gallery, revised ticket purchase flow, Spotify embeds, artist social links, related events feed.",
  state: { name: "In Progress", type: "started" },
  assignee: { name: "Anders Norén", displayName: "andersnoren" },
  comments: [
    {
      body: "Much closer. Some notes: treat the images cohesively with the blue colored style, style/color the map, don't love the menu icon.",
      createdAt: "2026-04-28T15:56:20.695Z",
      user: { displayName: "pablo.honey" },
    },
    {
      body: "@andersnoren flagging that the partner is thinking they'll have upwards of 50 shows for sale at a time, so we may want to be mindful with pagination.",
      createdAt: "2026-04-20T17:26:49.414Z",
      user: { displayName: "katie.mccanna" },
    },
  ],
  url: "https://linear.app/a8c/issue/DSG51-436/the-pocket-nyc-or-phase-2-design",
  dueDate: null,
  updatedAt: "2026-04-30T16:04:02.623Z",
};

const MOCK_SUBTASKS: LinearIssue[] = [
  {
    identifier: "DSG51-437",
    title: "Single event page — expanded gallery + tiered ticketing",
    priority: 0,
    state: { name: "In Progress", type: "started" },
    team: { key: "DSG51" },
    assignee: { name: "Anders Norén", displayName: "andersnoren" },
    dueDate: null,
    updatedAt: "2026-04-30T16:04:02.623Z",
    url: "https://linear.app/a8c/issue/DSG51-437",
  },
  {
    identifier: "DSG51-438",
    title: "Shows page + homepage roll-up",
    priority: 0,
    state: { name: "Todo", type: "unstarted" },
    team: { key: "DSG51" },
    assignee: { name: "Anders Norén", displayName: "andersnoren" },
    dueDate: null,
    updatedAt: "2026-04-14T10:00:00.000Z",
    url: "https://linear.app/a8c/issue/DSG51-438",
  },
  {
    identifier: "DSG51-439",
    title: "Menu page + About page Google Map embed",
    priority: 0,
    state: { name: "Todo", type: "unstarted" },
    team: { key: "DSG51" },
    assignee: null,
    dueDate: null,
    updatedAt: "2026-04-14T10:00:00.000Z",
    url: "https://linear.app/a8c/issue/DSG51-439",
  },
];

export class MockLinearTransport implements LinearClient {
  async getProject(projectId: string): Promise<LinearProject | null> {
    if (projectId === MOCK_PROJECT.id) return MOCK_PROJECT;
    return null;
  }

  async getProjectIssues(_projectId: string): Promise<LinearIssue[]> {
    return MOCK_PHASE_ISSUES;
  }

  async getProjectUpdates(_projectId: string): Promise<LinearProjectUpdate[]> {
    return MOCK_PROJECT_UPDATES;
  }

  async getIssue(identifier: string): Promise<LinearIssueDetail | null> {
    if (identifier === "DSG51-436") return MOCK_DESIGN_ISSUE_DETAIL;
    return null;
  }

  async getSubtasks(issueId: string): Promise<LinearIssue[]> {
    if (issueId === "DSG51-436") return MOCK_SUBTASKS;
    return [];
  }
}
