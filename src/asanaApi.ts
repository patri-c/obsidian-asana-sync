import { requestUrl, RequestUrlParam } from "obsidian";

const BASE_URL = "https://app.asana.com/api/1.0";

export interface AsanaTask {
  gid: string;
  name: string;
  completed: boolean;
  due_on: string | null;
  assignee: { gid: string; name: string } | null;
  permalink_url: string;
  notes: string;
  memberships: Array<{
    project: { gid: string; name: string };
    section: { gid: string; name: string };
  }>;
}

export interface AsanaProject {
  gid: string;
  name: string;
}

export interface AsanaWorkspace {
  gid: string;
  name: string;
}

export interface AsanaSection {
  gid: string;
  name: string;
}

export interface AsanaUser {
  gid: string;
  name: string;
  email: string;
}

async function asanaRequest(
  token: string,
  endpoint: string,
  method: string = "GET",
  body?: Record<string, unknown>
): Promise<unknown> {
  const params: RequestUrlParam = {
    url: `${BASE_URL}${endpoint}`,
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body) {
    params.body = JSON.stringify({ data: body });
  }
  const response = await requestUrl(params);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Asana API error: ${response.status} ${JSON.stringify(response.json)}`
    );
  }
  return response.json;
}

export async function fetchWorkspaces(
  token: string
): Promise<AsanaWorkspace[]> {
  const result = (await asanaRequest(token, "/workspaces")) as {
    data: AsanaWorkspace[];
  };
  return result.data;
}

export async function fetchProjects(
  token: string,
  workspaceGid: string,
  includeArchived: boolean = false
): Promise<AsanaProject[]> {
  const archived = includeArchived ? "" : "&archived=false";
  const result = (await asanaRequest(
    token,
    `/workspaces/${workspaceGid}/projects?limit=100${archived}`
  )) as { data: AsanaProject[] };
  return result.data;
}

export async function fetchSections(
  token: string,
  projectGid: string
): Promise<AsanaSection[]> {
  const result = (await asanaRequest(
    token,
    `/projects/${projectGid}/sections`
  )) as { data: AsanaSection[] };
  return result.data;
}

export async function fetchCurrentUser(token: string): Promise<AsanaUser> {
  const result = (await asanaRequest(token, "/users/me")) as {
    data: AsanaUser;
  };
  return result.data;
}

export async function fetchUserTaskListGid(
  token: string,
  userGid: string,
  workspaceGid: string
): Promise<string> {
  const result = (await asanaRequest(
    token,
    `/users/${userGid}/user_task_list?workspace=${workspaceGid}`
  )) as { data: { gid: string } };
  return result.data.gid;
}

export async function fetchProjectTasks(
  token: string,
  projectGid: string
): Promise<AsanaTask[]> {
  const fields =
    "gid,name,completed,due_on,assignee,assignee.name,permalink_url,notes,memberships.project,memberships.project.name,memberships.section,memberships.section.name";
  const allTasks: AsanaTask[] = [];
  let offset: string | null = null;

  do {
    const offsetParam = offset ? `&offset=${offset}` : "";
    const result = (await asanaRequest(
      token,
      `/projects/${projectGid}/tasks?opt_fields=${fields}&limit=100${offsetParam}`
    )) as {
      data: AsanaTask[];
      next_page: { offset: string } | null;
    };
    allTasks.push(...result.data);
    offset = result.next_page?.offset ?? null;
  } while (offset);

  return allTasks;
}

export async function fetchUserTasks(
  token: string,
  userTaskListGid: string
): Promise<AsanaTask[]> {
  const fields =
    "gid,name,completed,due_on,assignee,assignee.name,permalink_url,notes,memberships.project,memberships.project.name,memberships.section,memberships.section.name";
  const allTasks: AsanaTask[] = [];
  let offset: string | null = null;

  do {
    const offsetParam = offset ? `&offset=${offset}` : "";
    const result = (await asanaRequest(
      token,
      `/user_task_lists/${userTaskListGid}/tasks?opt_fields=${fields}&limit=100${offsetParam}`
    )) as {
      data: AsanaTask[];
      next_page: { offset: string } | null;
    };
    allTasks.push(...result.data);
    offset = result.next_page?.offset ?? null;
  } while (offset);

  return allTasks;
}

export async function updateTaskCompletion(
  token: string,
  taskGid: string,
  completed: boolean
): Promise<void> {
  await asanaRequest(token, `/tasks/${taskGid}`, "PUT", { completed });
}

export async function createTask(
  token: string,
  name: string,
  projectGid: string,
  sectionGid?: string,
  dueOn?: string,
  assigneeGid?: string
): Promise<AsanaTask> {
  const body: Record<string, unknown> = {
    name,
    projects: [projectGid],
  };
  if (dueOn) body.due_on = dueOn;
  if (assigneeGid) body.assignee = assigneeGid;

  const result = (await asanaRequest(token, "/tasks", "POST", body)) as {
    data: AsanaTask;
  };

  if (sectionGid) {
    await asanaRequest(
      token,
      `/sections/${sectionGid}/addTask`,
      "POST",
      { task: result.data.gid } as Record<string, unknown>
    );
  }

  return result.data;
}

export async function validateToken(token: string): Promise<boolean> {
  try {
    await fetchCurrentUser(token);
    return true;
  } catch {
    return false;
  }
}
