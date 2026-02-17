import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
  FuzzySuggestModal,
} from "obsidian";
import type AsanaSyncPlugin from "./main";
import {
  fetchWorkspaces,
  fetchProjects,
  fetchCurrentUser,
  fetchUserTaskListGid,
  validateToken,
  AsanaProject,
  AsanaWorkspace,
} from "./asanaApi";
import { SyncedProject } from "./types";

class WorkspaceSelectModal extends FuzzySuggestModal<AsanaWorkspace> {
  private items: AsanaWorkspace[];
  private resolve: (value: AsanaWorkspace | null) => void;
  private resolved = false;

  constructor(
    app: App,
    items: AsanaWorkspace[],
    resolve: (value: AsanaWorkspace | null) => void
  ) {
    super(app);
    this.items = items;
    this.resolve = resolve;
    this.setPlaceholder("Select a workspace");
  }

  getItems(): AsanaWorkspace[] {
    return this.items;
  }

  getItemText(item: AsanaWorkspace): string {
    return item.name;
  }

  onChooseItem(item: AsanaWorkspace): void {
    if (!this.resolved) {
      this.resolved = true;
      this.resolve(item);
    }
  }

  onClose(): void {
    // Defer so onChooseItem has a chance to fire first
    // (Obsidian calls onClose before onChooseItem)
    setTimeout(() => {
      if (!this.resolved) {
        this.resolved = true;
        this.resolve(null);
      }
    }, 100);
  }
}

class ProjectSelectModal extends FuzzySuggestModal<
  AsanaProject & { isMyTasks?: boolean }
> {
  private items: (AsanaProject & { isMyTasks?: boolean })[];
  private resolve: (
    value: (AsanaProject & { isMyTasks?: boolean }) | null
  ) => void;
  private resolved = false;

  constructor(
    app: App,
    items: (AsanaProject & { isMyTasks?: boolean })[],
    resolve: (
      value: (AsanaProject & { isMyTasks?: boolean }) | null
    ) => void
  ) {
    super(app);
    this.items = items;
    this.resolve = resolve;
    this.setPlaceholder("Select a project to sync");
  }

  getItems(): (AsanaProject & { isMyTasks?: boolean })[] {
    return this.items;
  }

  getItemText(item: AsanaProject & { isMyTasks?: boolean }): string {
    return item.isMyTasks ? `👤 ${item.name}` : item.name;
  }

  onChooseItem(
    item: AsanaProject & { isMyTasks?: boolean }
  ): void {
    if (!this.resolved) {
      this.resolved = true;
      this.resolve(item);
    }
  }

  onClose(): void {
    // Defer so onChooseItem has a chance to fire first
    // (Obsidian calls onClose before onChooseItem)
    setTimeout(() => {
      if (!this.resolved) {
        this.resolved = true;
        this.resolve(null);
      }
    }, 100);
  }
}

export class AsanaSyncSettingTab extends PluginSettingTab {
  plugin: AsanaSyncPlugin;

  constructor(app: App, plugin: AsanaSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // --- API Token ---
    let tokenInputEl: HTMLInputElement;
    new Setting(containerEl)
      .setName("Asana Personal Access Token")
      .setDesc(
        "Create one at https://app.asana.com/0/my-apps → Create new token"
      )
      .addText((text) => {
        text.setPlaceholder("Enter your access token");
        text.inputEl.type = "password";
        text.inputEl.style.width = "300px";
        text.inputEl.value = this.plugin.settings.asanaAccessToken;
        tokenInputEl = text.inputEl;
      })
      .addButton((button) =>
        button.setButtonText("Save token").onClick(async () => {
          const val = tokenInputEl.value.trim();
          this.plugin.settings.asanaAccessToken = val;
          await this.plugin.saveSettings();
          new Notice(val ? "Token saved" : "Token cleared");
        })
      );

    // --- Validate Token ---
    new Setting(containerEl)
      .setName("Validate token")
      .setDesc("Test your Asana connection")
      .addButton((button) =>
        button.setButtonText("Test connection").onClick(async () => {
          // Read directly from the input in case the user hasn't clicked Save yet
          const inputToken = tokenInputEl.value.trim();
          if (inputToken && inputToken !== this.plugin.settings.asanaAccessToken) {
            this.plugin.settings.asanaAccessToken = inputToken;
            await this.plugin.saveSettings();
          }
          const token = this.plugin.settings.asanaAccessToken;
          if (!token) {
            new Notice("Please enter and save an access token first");
            return;
          }
          button.setButtonText("Testing...");
          button.setDisabled(true);
          try {
            const valid = await validateToken(token);
            if (valid) {
              const user = await fetchCurrentUser(token);
              this.plugin.settings.userGid = user.gid;
              await this.plugin.saveSettings();
              new Notice(`Connected as ${user.name} (${user.email})`);
            } else {
              new Notice("Invalid token - please check and try again");
            }
          } catch (e) {
            new Notice("Connection failed - check token and try again");
          }
          button.setButtonText("Test connection");
          button.setDisabled(false);
        })
      );

    // --- Workspace ---
    new Setting(containerEl)
      .setName("Workspace")
      .setDesc(
        this.plugin.settings.workspaceName
          ? `Current: ${this.plugin.settings.workspaceName}`
          : "Select your Asana workspace"
      )
      .addButton((button) =>
        button.setButtonText("Select workspace").onClick(async () => {
          const token = this.plugin.settings.asanaAccessToken;
          if (!token) {
            new Notice("Please enter an access token first");
            return;
          }
          try {
            const workspaces = await fetchWorkspaces(token);
            if (workspaces.length === 0) {
              new Notice("No workspaces found");
              return;
            }
            const selected = await new Promise<AsanaWorkspace | null>(
              (resolve) => {
                new WorkspaceSelectModal(this.app, workspaces, resolve).open();
              }
            );
            if (selected) {
              this.plugin.settings.workspaceGid = selected.gid;
              this.plugin.settings.workspaceName = selected.name;
              await this.plugin.saveSettings();
              this.display(); // refresh
            }
          } catch (e) {
            new Notice("Failed to fetch workspaces");
          }
        })
      );

    // --- Sync Folder ---
    new Setting(containerEl)
      .setName("Sync folder")
      .setDesc("Folder where synced project notes will be created")
      .addText((text) =>
        text
          .setPlaceholder("Asana")
          .setValue(this.plugin.settings.syncFolder)
          .onChange(async (value) => {
            this.plugin.settings.syncFolder = value || "Asana";
            await this.plugin.saveSettings();
          })
      );

    // --- Sync Interval ---
    new Setting(containerEl)
      .setName("Sync interval (minutes)")
      .setDesc("How often to auto-sync (0 to disable auto-sync)")
      .addText((text) =>
        text
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.syncIntervalMinutes))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num >= 0) {
              this.plugin.settings.syncIntervalMinutes = num;
              await this.plugin.saveSettings();
              this.plugin.restartSyncInterval();
            }
          })
      );

    // --- Show Due Dates ---
    new Setting(containerEl)
      .setName("Show due dates")
      .setDesc("Display due dates on synced tasks")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showDueDates)
          .onChange(async (value) => {
            this.plugin.settings.showDueDates = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Show Assignees ---
    new Setting(containerEl)
      .setName("Show assignees")
      .setDesc("Display assignee names on synced tasks")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showAssignees)
          .onChange(async (value) => {
            this.plugin.settings.showAssignees = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Show Completed Tasks ---
    new Setting(containerEl)
      .setName("Show completed tasks")
      .setDesc(
        "Include completed tasks in synced notes. When off, completed tasks are hidden from notes but completion changes are still synced to Asana."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showCompletedTasks)
          .onChange(async (value) => {
            this.plugin.settings.showCompletedTasks = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Synced Projects ---
    containerEl.createEl("h3", { text: "Synced Projects" });

    if (this.plugin.settings.syncedProjects.length === 0) {
      containerEl.createEl("p", {
        text: "No projects configured for sync. Click 'Add project' below.",
        cls: "setting-item-description",
      });
    }

    for (let i = 0; i < this.plugin.settings.syncedProjects.length; i++) {
      const project = this.plugin.settings.syncedProjects[i];
      new Setting(containerEl)
        .setName(project.projectName)
        .setDesc(`Note: ${project.notePath}`)
        .addButton((button) =>
          button
            .setButtonText("Remove")
            .setWarning()
            .onClick(async () => {
              this.plugin.settings.syncedProjects.splice(i, 1);
              await this.plugin.saveSettings();
              this.display();
            })
        );
    }

    // --- Add Project Button ---
    new Setting(containerEl).addButton((button) =>
      button.setButtonText("Add project").setCta().onClick(async () => {
        await this.addProject();
      })
    );

    // --- Add My Tasks Button ---
    new Setting(containerEl).addButton((button) =>
      button.setButtonText("Add My Tasks").onClick(async () => {
        await this.addMyTasks();
      })
    );

    // --- Buy Me a Coffee ---
    containerEl.createEl("hr");
    const coffeeDiv = containerEl.createEl("div", {
      cls: "setting-item",
    });
    coffeeDiv.style.display = "flex";
    coffeeDiv.style.alignItems = "center";
    coffeeDiv.style.justifyContent = "center";
    coffeeDiv.style.padding = "1em 0";
    const coffeeLink = coffeeDiv.createEl("a", {
      href: "https://buymeacoffee.com/jeanpatric",
    });
    const coffeeImg = coffeeLink.createEl("img");
    coffeeImg.src =
      "https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png";
    coffeeImg.alt = "Buy Me A Coffee";
    coffeeImg.style.height = "40px";
    coffeeImg.style.width = "auto";
  }

  private async addProject(): Promise<void> {
    const token = this.plugin.settings.asanaAccessToken;
    const workspaceGid = this.plugin.settings.workspaceGid;

    if (!token || !workspaceGid) {
      new Notice("Please configure your access token and select a workspace first");
      return;
    }

    try {
      const projects = await fetchProjects(token, workspaceGid);
      if (projects.length === 0) {
        new Notice("No projects found in this workspace");
        return;
      }

      // Filter out already synced projects
      const syncedGids = new Set(
        this.plugin.settings.syncedProjects.map((p) => p.projectGid)
      );
      const available = projects.filter((p) => !syncedGids.has(p.gid));

      if (available.length === 0) {
        new Notice("All projects are already being synced");
        return;
      }

      const selected = await new Promise<AsanaProject | null>((resolve) => {
        new ProjectSelectModal(this.app, available, resolve).open();
      });

      if (selected) {
        const sanitizedName = selected.name.replace(/[\\/:*?"<>|]/g, "-");
        const notePath = `${this.plugin.settings.syncFolder}/${sanitizedName}.md`;
        const syncedProject: SyncedProject = {
          projectGid: selected.gid,
          projectName: selected.name,
          notePath,
          isMyTasks: false,
        };
        this.plugin.settings.syncedProjects.push(syncedProject);
        await this.plugin.saveSettings();
        this.display();
        new Notice(`Added "${selected.name}" for sync`);
      }
    } catch (e) {
      new Notice("Failed to fetch projects");
      console.error(e);
    }
  }

  private async addMyTasks(): Promise<void> {
    const token = this.plugin.settings.asanaAccessToken;
    const workspaceGid = this.plugin.settings.workspaceGid;

    if (!token || !workspaceGid) {
      new Notice("Please configure your access token and select a workspace first");
      return;
    }

    // Check if My Tasks is already synced
    if (this.plugin.settings.syncedProjects.some((p) => p.isMyTasks)) {
      new Notice("My Tasks is already being synced");
      return;
    }

    try {
      let userGid = this.plugin.settings.userGid;
      if (!userGid) {
        const user = await fetchCurrentUser(token);
        userGid = user.gid;
        this.plugin.settings.userGid = userGid;
      }

      const userTaskListGid = await fetchUserTaskListGid(
        token,
        userGid,
        workspaceGid
      );

      const notePath = `${this.plugin.settings.syncFolder}/My Tasks.md`;
      const syncedProject: SyncedProject = {
        projectGid: userTaskListGid,
        projectName: "My Tasks",
        notePath,
        isMyTasks: true,
        userTaskListGid,
      };
      this.plugin.settings.syncedProjects.push(syncedProject);
      await this.plugin.saveSettings();
      this.display();
      new Notice("Added My Tasks for sync");
    } catch (e) {
      new Notice("Failed to add My Tasks");
      console.error(e);
    }
  }
}
