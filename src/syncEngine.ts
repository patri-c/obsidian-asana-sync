import { Notice, TFile, Vault } from "obsidian";
import {
  AsanaTask,
  fetchProjectTasks,
  fetchUserTasks,
  updateTaskCompletion,
} from "./asanaApi";
import { AsanaSyncSettings, ParsedTask, SyncedProject } from "./types";

// Task line format:
// - [ ] Task name 📅 2024-01-15 👤 John Doe <!-- asana:GID -->
// - [x] Completed task <!-- asana:GID -->

const TASK_LINE_REGEX =
  /^(\s*- \[)([ xX])(\] )(.+?)(?:\s*📅\s*(\d{4}-\d{2}-\d{2}))?(?:\s*👤\s*(.+?))?(?:\s*<!--\s*asana:(\w+)\s*-->)?\s*$/;

const ASANA_GID_REGEX = /<!--\s*asana:(\w+)\s*-->/;

export function parseTaskLine(line: string, lineNumber: number): ParsedTask | null {
  const match = line.match(TASK_LINE_REGEX);
  if (!match) return null;
  return {
    line,
    lineNumber,
    completed: match[2] === "x" || match[2] === "X",
    name: match[4].trim(),
    asanaGid: match[7] || null,
    dueDate: match[5] || null,
    assignee: match[6]?.trim() || null,
  };
}

export function formatTaskLine(
  task: AsanaTask,
  showDueDates: boolean,
  showAssignees: boolean
): string {
  const checkbox = task.completed ? "- [x]" : "- [ ]";
  let line = `${checkbox} ${task.name}`;
  if (showDueDates && task.due_on) {
    line += ` 📅 ${task.due_on}`;
  }
  if (showAssignees && task.assignee?.name) {
    line += ` 👤 ${task.assignee.name}`;
  }
  line += ` <!-- asana:${task.gid} -->`;
  return line;
}

export function parseNoteContent(content: string): {
  frontmatter: string;
  header: string;
  tasks: ParsedTask[];
  sections: Map<string, ParsedTask[]>;
  rawLines: string[];
} {
  const lines = content.split("\n");
  const tasks: ParsedTask[] = [];
  const sections = new Map<string, ParsedTask[]>();
  let currentSection = "(Unsectioned)";
  let frontmatter = "";
  let header = "";
  let inFrontmatter = false;
  let frontmatterDone = false;
  let headerDone = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Handle YAML frontmatter
    if (i === 0 && line === "---") {
      inFrontmatter = true;
      frontmatter += line + "\n";
      continue;
    }
    if (inFrontmatter) {
      frontmatter += line + "\n";
      if (line === "---") {
        inFrontmatter = false;
        frontmatterDone = true;
      }
      continue;
    }

    // Handle header (title line)
    if (frontmatterDone && !headerDone) {
      if (line.startsWith("# ")) {
        header = line;
        headerDone = true;
        continue;
      } else if (line.trim() === "") {
        continue; // skip blank lines between frontmatter and header
      }
    }

    // Detect section headers (## Section Name)
    if (line.startsWith("## ")) {
      currentSection = line.replace(/^## /, "").trim();
      if (!sections.has(currentSection)) {
        sections.set(currentSection, []);
      }
      continue;
    }

    // Parse task lines
    const parsed = parseTaskLine(line, i);
    if (parsed) {
      tasks.push(parsed);
      if (!sections.has(currentSection)) {
        sections.set(currentSection, []);
      }
      sections.get(currentSection)!.push(parsed);
    }
  }

  return { frontmatter, header, tasks, sections, rawLines: lines };
}

export function generateNoteContent(
  projectName: string,
  projectGid: string,
  isMyTasks: boolean,
  asanaTasks: AsanaTask[],
  showDueDates: boolean,
  showAssignees: boolean,
  showCompletedTasks: boolean = true
): string {
  const lines: string[] = [];

  // Frontmatter
  lines.push("---");
  lines.push(`asana_project_gid: "${projectGid}"`);
  lines.push(`asana_is_my_tasks: ${isMyTasks}`);
  lines.push(`asana_last_sync: "${new Date().toISOString()}"`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${projectName}`);
  lines.push("");

  // Filter out completed tasks if setting is off
  const filteredTasks = showCompletedTasks
    ? asanaTasks
    : asanaTasks.filter((t) => !t.completed);

  // Group tasks by section
  const sectionMap = new Map<string, AsanaTask[]>();
  for (const task of filteredTasks) {
    let sectionName = "(Unsectioned)";
    if (task.memberships && task.memberships.length > 0) {
      // Find the membership for this project
      const membership = task.memberships.find(
        (m) => m.project?.gid === projectGid
      );
      if (membership?.section?.name) {
        sectionName = membership.section.name;
      }
    }
    if (!sectionMap.has(sectionName)) {
      sectionMap.set(sectionName, []);
    }
    sectionMap.get(sectionName)!.push(task);
  }

  // Write sections
  for (const [sectionName, sectionTasks] of sectionMap) {
    if (sectionName !== "(Unsectioned)") {
      lines.push(`## ${sectionName}`);
      lines.push("");
    }
    for (const task of sectionTasks) {
      lines.push(formatTaskLine(task, showDueDates, showAssignees));
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function syncProject(
  vault: Vault,
  settings: AsanaSyncSettings,
  syncedProject: SyncedProject
): Promise<{ added: number; updated: number; completionChanges: number }> {
  const token = settings.asanaAccessToken;
  let stats = { added: 0, updated: 0, completionChanges: 0 };

  // Fetch tasks from Asana
  let asanaTasks: AsanaTask[];
  if (syncedProject.isMyTasks && syncedProject.userTaskListGid) {
    asanaTasks = await fetchUserTasks(token, syncedProject.userTaskListGid);
  } else {
    asanaTasks = await fetchProjectTasks(token, syncedProject.projectGid);
  }

  // Build a map of Asana tasks by GID
  const asanaTaskMap = new Map<string, AsanaTask>();
  for (const task of asanaTasks) {
    asanaTaskMap.set(task.gid, task);
  }

  // Check if note exists
  const notePath = syncedProject.notePath;
  let file = vault.getAbstractFileByPath(notePath);

  if (!file || !(file instanceof TFile)) {
    // Create the note from scratch
    const content = generateNoteContent(
      syncedProject.projectName,
      syncedProject.projectGid,
      syncedProject.isMyTasks,
      asanaTasks,
      settings.showDueDates,
      settings.showAssignees,
      settings.showCompletedTasks
    );

    // Ensure folder exists
    const folderPath = notePath.substring(0, notePath.lastIndexOf("/"));
    if (folderPath) {
      const folder = vault.getAbstractFileByPath(folderPath);
      if (!folder) {
        await vault.createFolder(folderPath);
      }
    }

    await vault.create(notePath, content);
    stats.added = asanaTasks.length;
    return stats;
  }

  // Note exists - do bidirectional sync
  const existingContent = await vault.read(file as TFile);
  const parsed = parseNoteContent(existingContent);

  // Build map of existing tasks by GID
  const existingTaskMap = new Map<string, ParsedTask>();
  for (const task of parsed.tasks) {
    if (task.asanaGid) {
      existingTaskMap.set(task.asanaGid, task);
    }
  }

  // --- Step 1: Push completion changes from Obsidian to Asana ---
  for (const [gid, obsidianTask] of existingTaskMap) {
    const asanaTask = asanaTaskMap.get(gid);
    if (!asanaTask) continue;

    if (obsidianTask.completed !== asanaTask.completed) {
      // Obsidian state differs from Asana - push Obsidian state to Asana
      // unless the Asana task was modified more recently (we don't track
      // modification times per-task in Obsidian, so we use a simple
      // heuristic: if Obsidian was edited since last sync, Obsidian wins)
      try {
        await updateTaskCompletion(token, gid, obsidianTask.completed);
        stats.completionChanges++;
      } catch (e) {
        console.error(`Failed to update task ${gid} in Asana:`, e);
      }
    }
  }

  // --- Step 2: Rebuild note content with merged state ---
  // Re-fetch to get the state after our updates
  if (syncedProject.isMyTasks && syncedProject.userTaskListGid) {
    asanaTasks = await fetchUserTasks(token, syncedProject.userTaskListGid);
  } else {
    asanaTasks = await fetchProjectTasks(token, syncedProject.projectGid);
  }

  // Rebuild the asana task map with fresh data
  asanaTaskMap.clear();
  for (const task of asanaTasks) {
    asanaTaskMap.set(task.gid, task);
  }

  // Track which Asana tasks are already in the note
  const seenGids = new Set<string>();

  // Build new lines
  const newLines: string[] = [];
  let inFrontmatter = false;
  let updatedFrontmatter = false;
  let currentSection = "(Unsectioned)";

  for (let i = 0; i < parsed.rawLines.length; i++) {
    const line = parsed.rawLines[i];

    // Handle frontmatter - update last_sync time
    if (i === 0 && line === "---") {
      inFrontmatter = true;
      newLines.push(line);
      continue;
    }
    if (inFrontmatter) {
      if (line === "---") {
        inFrontmatter = false;
        if (!updatedFrontmatter) {
          newLines.push(`asana_last_sync: "${new Date().toISOString()}"`);
          updatedFrontmatter = true;
        }
        newLines.push(line);
      } else if (line.startsWith("asana_last_sync:")) {
        newLines.push(`asana_last_sync: "${new Date().toISOString()}"`);
        updatedFrontmatter = true;
      } else {
        newLines.push(line);
      }
      continue;
    }

    // Track sections
    if (line.startsWith("## ")) {
      currentSection = line.replace(/^## /, "").trim();
      newLines.push(line);
      continue;
    }

    // Handle existing task lines
    const gidMatch = line.match(ASANA_GID_REGEX);
    if (gidMatch) {
      const gid = gidMatch[1];
      const asanaTask = asanaTaskMap.get(gid);
      if (asanaTask) {
        // If hiding completed tasks, skip completed ones (remove from note)
        if (!settings.showCompletedTasks && asanaTask.completed) {
          seenGids.add(gid);
          continue;
        }
        // Update the line with current Asana state
        newLines.push(
          formatTaskLine(asanaTask, settings.showDueDates, settings.showAssignees)
        );
        seenGids.add(gid);
        stats.updated++;
      } else {
        // Task no longer in Asana project - keep it with a strikethrough marker
        newLines.push(line);
        seenGids.add(gid);
      }
      continue;
    }

    // Keep non-task lines as-is
    newLines.push(line);
  }

  // --- Step 3: Append new tasks from Asana that aren't in the note yet ---
  const newTasks: AsanaTask[] = [];
  for (const task of asanaTasks) {
    if (!seenGids.has(task.gid)) {
      // Skip completed tasks if setting is off
      if (!settings.showCompletedTasks && task.completed) continue;
      newTasks.push(task);
      stats.added++;
    }
  }

  if (newTasks.length > 0) {
    // Group new tasks by section
    const newTasksBySection = new Map<string, AsanaTask[]>();
    for (const task of newTasks) {
      let sectionName = "(Unsectioned)";
      if (task.memberships && task.memberships.length > 0) {
        const membership = task.memberships.find(
          (m) => m.project?.gid === syncedProject.projectGid
        );
        if (membership?.section?.name) {
          sectionName = membership.section.name;
        }
      }
      if (!newTasksBySection.has(sectionName)) {
        newTasksBySection.set(sectionName, []);
      }
      newTasksBySection.get(sectionName)!.push(task);
    }

    // Find existing sections in the note and append tasks there,
    // or create new sections
    for (const [sectionName, tasks] of newTasksBySection) {
      // Check if section already exists
      const sectionHeader = `## ${sectionName}`;
      const sectionIndex = newLines.findIndex(
        (l) => l.trim() === sectionHeader
      );

      if (sectionIndex >= 0 && sectionName !== "(Unsectioned)") {
        // Find the end of this section (next ## or end of file)
        let insertIdx = sectionIndex + 1;
        while (
          insertIdx < newLines.length &&
          !newLines[insertIdx].startsWith("## ")
        ) {
          insertIdx++;
        }
        // Insert before the next section (or end), after any trailing blank line
        const taskLines = tasks.map((t) =>
          formatTaskLine(t, settings.showDueDates, settings.showAssignees)
        );
        newLines.splice(insertIdx, 0, ...taskLines);
      } else if (sectionName !== "(Unsectioned)") {
        // Create new section
        newLines.push("");
        newLines.push(sectionHeader);
        newLines.push("");
        for (const task of tasks) {
          newLines.push(
            formatTaskLine(task, settings.showDueDates, settings.showAssignees)
          );
        }
      } else {
        // Unsectioned - append at the end
        for (const task of tasks) {
          newLines.push(
            formatTaskLine(task, settings.showDueDates, settings.showAssignees)
          );
        }
      }
    }
  }

  // Write updated content
  const newContent = newLines.join("\n");
  if (newContent !== existingContent) {
    await vault.modify(file as TFile, newContent);
  }

  return stats;
}

export async function syncAllProjects(
  vault: Vault,
  settings: AsanaSyncSettings
): Promise<void> {
  if (!settings.asanaAccessToken) {
    new Notice("Asana Sync: No access token configured");
    return;
  }

  if (settings.syncedProjects.length === 0) {
    new Notice("Asana Sync: No projects configured for sync");
    return;
  }

  let totalAdded = 0;
  let totalUpdated = 0;
  let totalCompletionChanges = 0;

  for (const project of settings.syncedProjects) {
    try {
      const stats = await syncProject(vault, settings, project);
      totalAdded += stats.added;
      totalUpdated += stats.updated;
      totalCompletionChanges += stats.completionChanges;
    } catch (e) {
      console.error(`Failed to sync project ${project.projectName}:`, e);
      new Notice(`Asana Sync: Failed to sync "${project.projectName}"`);
    }
  }

  const parts: string[] = [];
  if (totalAdded > 0) parts.push(`${totalAdded} added`);
  if (totalCompletionChanges > 0)
    parts.push(`${totalCompletionChanges} completion changes`);
  if (parts.length > 0) {
    new Notice(`Asana Sync: ${parts.join(", ")}`);
  }
}
