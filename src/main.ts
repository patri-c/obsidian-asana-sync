import { Notice, Plugin, TFile } from "obsidian";
import { AsanaSyncSettings, DEFAULT_SETTINGS } from "./types";
import { AsanaSyncSettingTab } from "./settings";
import { syncAllProjects, syncProject, parseTaskLine } from "./syncEngine";
import { updateTaskCompletion } from "./asanaApi";

export default class AsanaSyncPlugin extends Plugin {
  settings: AsanaSyncSettings = DEFAULT_SETTINGS;
  private syncIntervalId: number | null = null;
  private isSyncing = false;
  // Track files currently being modified by the sync engine to avoid
  // re-triggering sync from our own writes.
  private fileModifiedBySync = new Set<string>();

  async onload(): Promise<void> {
    await this.loadSettings();

    // Add settings tab
    this.addSettingTab(new AsanaSyncSettingTab(this.app, this));

    // Add sync command
    this.addCommand({
      id: "sync-asana",
      name: "Sync all projects",
      callback: () => this.runSync(),
    });

    // Add ribbon icon
    this.addRibbonIcon("refresh-cw", "Sync Asana", () => this.runSync());

    // Watch for file modifications (checkbox changes in Obsidian)
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.handleFileModify(file);
        }
      })
    );

    // Start auto-sync interval
    this.restartSyncInterval();

    // Initial sync after a short delay to let the vault fully load
    if (this.settings.asanaAccessToken && this.settings.syncedProjects.length > 0) {
      setTimeout(() => this.runSync(), 5000);
    }
  }

  onunload(): void {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  restartSyncInterval(): void {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }

    if (this.settings.syncIntervalMinutes > 0) {
      const ms = this.settings.syncIntervalMinutes * 60 * 1000;
      this.syncIntervalId = window.setInterval(() => this.runSync(), ms);
      this.registerInterval(this.syncIntervalId);
    }
  }

  private async runSync(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      // Mark all synced project note paths so we don't re-trigger on our own writes
      for (const project of this.settings.syncedProjects) {
        this.fileModifiedBySync.add(project.notePath);
      }

      await syncAllProjects(this.app.vault, this.settings);
    } catch (e) {
      console.error("Asana Sync: sync failed", e);
      new Notice("Asana Sync: sync failed - check console for details");
    } finally {
      this.isSyncing = false;
      // Clear the set after a short delay to allow the vault modify event to fire
      setTimeout(() => {
        this.fileModifiedBySync.clear();
      }, 2000);
    }
  }

  /**
   * Handle a file modification in the vault. If the file is a synced project
   * note, detect checkbox changes and push them to Asana.
   */
  private async handleFileModify(file: TFile): Promise<void> {
    // Don't re-trigger during our own sync writes
    if (this.fileModifiedBySync.has(file.path)) return;
    if (this.isSyncing) return;

    // Check if this file is one of our synced project notes
    const syncedProject = this.settings.syncedProjects.find(
      (p) => p.notePath === file.path
    );
    if (!syncedProject) return;

    // Debounce: wait a moment before processing to batch rapid edits
    // Use the file path as a key to avoid multiple timers for the same file
    const debounceKey = `asana-sync-debounce-${file.path}`;
    if ((this as Record<string, unknown>)[debounceKey]) {
      window.clearTimeout(
        (this as Record<string, unknown>)[debounceKey] as number
      );
    }
    (this as Record<string, unknown>)[debounceKey] = window.setTimeout(
      async () => {
        delete (this as Record<string, unknown>)[debounceKey];
        await this.processCheckboxChanges(file, syncedProject);
      },
      1500
    );
  }

  /**
   * Read the file, parse task lines, and push any completion changes to Asana.
   * This stores a snapshot of the last-known completion state per file so we
   * can detect changes on subsequent edits.
   */
  private lastKnownState = new Map<string, Map<string, boolean>>();

  private async processCheckboxChanges(
    file: TFile,
    syncedProject: { projectGid: string; projectName: string }
  ): Promise<void> {
    const token = this.settings.asanaAccessToken;
    if (!token) return;

    const content = await this.app.vault.read(file);
    const lines = content.split("\n");

    // Build current state
    const currentState = new Map<string, boolean>();
    for (let i = 0; i < lines.length; i++) {
      const parsed = parseTaskLine(lines[i], i);
      if (parsed?.asanaGid) {
        currentState.set(parsed.asanaGid, parsed.completed);
      }
    }

    // Compare with last known state
    const lastState = this.lastKnownState.get(file.path);
    if (lastState) {
      for (const [gid, completed] of currentState) {
        const wasCompleted = lastState.get(gid);
        if (wasCompleted !== undefined && wasCompleted !== completed) {
          // Completion state changed in Obsidian - push to Asana
          try {
            await updateTaskCompletion(token, gid, completed);
            const action = completed ? "completed" : "reopened";
            new Notice(
              `Asana: Task ${action} in "${syncedProject.projectName}"`
            );
          } catch (e) {
            console.error(`Failed to update task ${gid}:`, e);
            new Notice("Asana Sync: Failed to update task in Asana");
          }
        }
      }
    }

    // Update snapshot
    this.lastKnownState.set(file.path, currentState);
  }
}
