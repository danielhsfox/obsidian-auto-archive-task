# Auto Archive Task for Obsidian

Automatically move completed tasks to a dedicated section at the end of your note with timestamp. Smart handling of subtasks—only moves parent tasks when ALL subtasks are complete.

## ✨ What It Does

Mark a task as done and it's automatically moved to a `## Completed Tasks` section with a timestamp. Subtasks stay with their parent, and parent tasks only move when every subtask is complete.

## 🚀 Quick Start

1. **Install** from Community Plugins
2. **Enable** the plugin in settings
3. **Add to any note** in frontmatter:
```yaml
---
automove: true
---
```
4. **Start checking tasks**—they'll auto-archive

## 🎯 Features

- **Automatically moves** completed tasks to the end of your note
- **Adds timestamp** with configurable format and icon
- **Smart subtask handling** – parent task only moves when ALL subtasks are done
- **Preview mode support** – clicks in reading view work seamlessly
- **Per-note activation** – enable only on notes you want (`automove: true`)
- **Customizable** – icon, date format, section title, and more
- **Two commands** – manual move and clear section

## 📝 Basic Setup

### 1. Activate on a note
Add to frontmatter:
```yaml
---
automove: true
---
```

### 2. Create a completed tasks section (optional)
The plugin can create it automatically, or you can add:
```markdown
## Completed Tasks
---
```

### 3. Start using it
- `- [ ] Task` → check it → moves to bottom with `✅ 2024-01-01 14:30:00`
- Subtasks get timestamp on same line
- Parent tasks move with ALL subtasks complete

## 🧠 Smart Behavior

| Scenario | What happens |
|----------|--------------|
| ✅ Check individual task | Moves to Completed section + timestamp below |
| ✅ Check subtask | Adds timestamp on same line (stays in place) |
| ✅ Check parent with incomplete subtasks | Adds timestamp to parent only (no move) |
| ✅ Check parent with ALL subtasks done | **Moves entire block** + timestamp at end |
| 🔄 Uncheck completed task | Removes timestamp |

## ⚙️ Settings

| Setting | Description |
|---------|-------------|
| **Move automatically** | Enable/disable auto-moving |
| **Auto-switch to edit mode** | Temporarily switch from preview to edit when clicking |
| **Return to view mode** | Switch back to preview after processing |
| **Delay (ms)** | Wait time before moving (default: 300ms) |
| **Completion icon** | Icon for timestamp (default: ✅) |
| **Date format** | Moment.js format (default: `YYYY-MM-DD HH:mm:ss`) |
| **Create section automatically** | Auto-create `## Completed Tasks` if missing |
| **Section title** | Customize the heading (default: `## Completed Tasks`) |
| **Add --- separator** | Add horizontal line below section title |

## 🎨 Example

**Before:**
```markdown
- [ ] Write documentation
    - [x] Draft outline ✅ 2024-01-01 10:15:00
    - [x] Add examples ✅ 2024-01-01 10:30:00
- [ ] Review PR

## Completed Tasks
---
- [x] Setup project
✅ 2024-01-01 09:00:00
```

**After checking parent task:**
```markdown
- [ ] Review PR

## Completed Tasks
---
- [x] Setup project
✅ 2024-01-01 09:00:00
- [x] Write documentation
    - [x] Draft outline ✅ 2024-01-01 10:15:00
    - [x] Add examples ✅ 2024-01-01 10:30:00
✅ 2024-01-01 10:45:00
```

## ⌨️ Commands

| Command | Description |
|---------|-------------|
| `Move completed tasks to the end` | Manual trigger for current note |
| `Clear completed tasks section` | Remove all tasks from Completed section |

## ❓ FAQ

**Q: Why isn't my note moving tasks?**  
A: Add `automove: true` to the frontmatter. The plugin only runs on enabled notes.

**Q: My parent task won't move even though subtasks are done.**  
A: Check that ALL subtasks are either checked (`[x]`) OR have a timestamp (✅). The plugin detects both.

**Q: Timestamps are duplicating!**  
A: This was fixed in v1.0.0. Update to the latest version.

**Q: Does it work with Tasks plugin?**  
A: Yes! The plugin detects both `[x]` and your existing ✅ timestamps.

**Q: Can I change where tasks are archived?**  
A: Currently they move to a section in the same note. External archiving is planned.

## 🔧 Development

```bash
# Clone repository
cd .obsidian/plugins/
git clone https://github.com/yourusername/obsidian-auto-archive-task

# Install dependencies
npm install

# Build
npm run build

# Development mode with live reload
npm run dev
```

## 📄 License

MIT License - see [LICENSE](LICENSE)

Copyright (c) 2025 danielhsfox