# Asana Sync for Obsidian

Bidirectional sync between [Asana](https://asana.com) and [Obsidian](https://obsidian.md). Sync your Asana projects and My Tasks to dedicated Obsidian notes with two-way task completion tracking.

## Features

- **Bidirectional task sync** — Tasks from Asana projects appear as checkboxes in dedicated Obsidian notes. Each synced project gets its own note.
- **Two-way completion** — Check off a task in Obsidian and it completes in Asana. Complete a task in Asana and the checkbox updates in Obsidian on the next sync.
- **My Tasks support** — Sync your personal Asana "My Tasks" list alongside project tasks.
- **Sections preserved** — Asana project sections are rendered as headings (`## Section Name`) in the note.
- **Due dates** — Optionally display due dates inline on each task.
- **Assignees** — Optionally display assignee names inline on each task.
- **Show/hide completed tasks** — Choose whether completed tasks remain visible in your notes or are automatically hidden.
- **Auto-sync** — Configurable sync interval (default: every 5 minutes). Also supports manual sync via command palette or ribbon icon.

## Installation

### Manual installation

1. Download the latest release (`main.js`, `manifest.json`, `styles.css`) from the [Releases](https://github.com/jeanpatric/obsidian-asana-sync/releases) page.
2. Create a folder called `asana-sync` inside your vault's `.obsidian/plugins/` directory.
3. Copy the three files into that folder.
4. Open Obsidian Settings > Community plugins and enable **Asana Sync**.

### From community plugins (once approved)

1. Open Obsidian Settings > Community plugins > Browse.
2. Search for **Asana Sync**.
3. Click Install, then Enable.

## Setup

1. **Get an Asana Personal Access Token:**
   - Go to [https://app.asana.com/0/my-apps](https://app.asana.com/0/my-apps)
   - Click **Create new token**
   - Copy the token

2. **Configure the plugin:**
   - Open Obsidian Settings > Asana Sync
   - Paste your token and click **Save token**
   - Click **Test connection** to verify it works
   - Click **Select workspace** and choose your Asana workspace

3. **Add projects to sync:**
   - Click **Add project** to sync an Asana project, or
   - Click **Add My Tasks** to sync your personal task list

4. **Run a sync:**
   - Click the refresh icon in the ribbon, or
   - Use the command palette: `Asana Sync: Sync all projects`
   - Auto-sync runs on the configured interval

## How it works

Each synced project creates a Markdown note in your sync folder (default: `Asana/`). Tasks appear as checklist items:

```markdown
---
asana_project_gid: "123456789"
asana_is_my_tasks: false
asana_last_sync: "2025-01-15T10:30:00.000Z"
---

# My Project

## To Do

- [ ] Design the homepage 📅 2025-01-20 👤 Alice <!-- asana:111 -->
- [ ] Write API docs <!-- asana:222 -->

## In Progress

- [x] Set up CI/CD pipeline 👤 Bob <!-- asana:333 -->
```

The `<!-- asana:GID -->` comments link each checkbox to its Asana task. **Do not remove these comments** — they are required for sync to work.

### Sync behavior

- **Obsidian to Asana:** When you check/uncheck a checkbox in Obsidian, the change is pushed to Asana within a few seconds.
- **Asana to Obsidian:** On each sync cycle, the plugin fetches the latest state from Asana and updates the note. New tasks are appended to their respective sections.
- **Completed tasks:** When "Show completed tasks" is off, tasks completed in either direction are removed from the note on the next sync. The completion is still synced to Asana before removal.

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Access Token | Your Asana Personal Access Token | — |
| Workspace | The Asana workspace to sync from | — |
| Sync folder | Vault folder for synced notes | `Asana` |
| Sync interval | Minutes between auto-syncs (0 = manual only) | `5` |
| Show due dates | Display due dates on tasks | On |
| Show assignees | Display assignee names on tasks | On |
| Show completed tasks | Keep completed tasks visible in notes | Off |

## Support

If you find this plugin useful, consider supporting development:

<a href="https://buymeacoffee.com/jeanpatric" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="40"></a>

## License

[MIT](LICENSE)
