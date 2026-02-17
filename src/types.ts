export interface SyncedProject {
  projectGid: string;
  projectName: string;
  notePath: string;
  isMyTasks: boolean;
  userTaskListGid?: string;
}

export interface AsanaSyncSettings {
  asanaAccessToken: string;
  workspaceGid: string;
  workspaceName: string;
  syncedProjects: SyncedProject[];
  syncIntervalMinutes: number;
  syncFolder: string;
  showDueDates: boolean;
  showAssignees: boolean;
  showCompletedTasks: boolean;
  syncMyTasks: boolean;
  userGid: string;
}

export const DEFAULT_SETTINGS: AsanaSyncSettings = {
  asanaAccessToken: "",
  workspaceGid: "",
  workspaceName: "",
  syncedProjects: [],
  syncIntervalMinutes: 5,
  syncFolder: "Asana",
  showDueDates: true,
  showAssignees: true,
  showCompletedTasks: false,
  syncMyTasks: false,
  userGid: "",
};

export interface ParsedTask {
  line: string;
  lineNumber: number;
  completed: boolean;
  name: string;
  asanaGid: string | null;
  dueDate: string | null;
  assignee: string | null;
}
