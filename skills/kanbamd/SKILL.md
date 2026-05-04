---
name: kanbamd
description: Manage a Kanban board backed by Markdown files with YAML frontmatter. Use when the user wants to list, add, view, move, delete, or search cards on their kanbamd board. Also use when the user mentions "kanban", "board", "cards", "todo", "doing", "done", or any kanbamd command.
---

## Usage

kanbamd is a CLI for managing Kanban boards stored as Markdown files in column directories.

### Global options

All commands accept these global options before the subcommand:

| Option | Description |
|---|---|
| `--root <path>` | Override the board root directory |
| `--columns <cols>` | Override column names (comma-separated, e.g. `todo,doing,done`) |

If neither is provided, kanbamd searches upward from the current directory for a `.kanbamd.json` config file. Falls back to the current directory, auto-detecting columns from subdirectories.

### Commands

#### `kanbamd init`

Initialize a board in the current directory. Creates column subdirectories and a `.kanbamd.json` config file.

```bash
kanbamd init                           # interactive (prompts for custom fields)
kanbamd init --no-fields               # skip custom field setup
kanbamd init --root ./board --columns todo,doing,done
```

#### `kanbamd columns`

List all columns with card counts.

```bash
kanbamd columns
```

#### `kanbamd list`

List cards, grouped by column.

```bash
kanbamd list                           # all columns
kanbamd list --column todo             # single column
kanbamd list -c todo                   # short flag
```

Output format: `<order>. [<column>] <title> #<id> #<tag1> #<tag2>`

#### `kanbamd add`

Add a new card interactively. Prompts for: column (skipped if only one column exists), title (required), body, tags (comma-separated), custom fields (if defined in config), and order (defaults to last position).

```bash
kanbamd add
```

#### `kanbamd view`

View a card's full details: title, ID, column, order, tags, all custom fields, timestamps, and body.

```bash
kanbamd view <id>                      # view by ID
kanbamd view <id> --column todo        # disambiguate if same ID exists in multiple columns
kanbamd view                           # interactive card picker
```

#### `kanbamd move`

Move a card to another column. The source column's order is normalized afterward; the moved card is placed last in the target column. If only one other column exists, the target is auto-selected.

```bash
kanbamd move <id> --to done            # non-interactive
kanbamd move <id> --column todo --to done
kanbamd move                           # interactive picker for card and target
```

#### `kanbamd delete`

Delete a card. Always prompts for confirmation showing the card detail first. The source column's order is normalized afterward.

```bash
kanbamd delete <id>                    # delete by ID
kanbamd delete <id> --column todo      # disambiguate
kanbamd delete                         # interactive picker
```

#### `kanbamd search`

Fuzzy search cards using Fuse.js (threshold: 0.35, ignoreLocation: true). Searches title, tags, body, and ID.

```bash
kanbamd search "login bug"             # fuzzy search
kanbamd search "login" --tags bug,ui   # must have ALL specified tags
kanbamd search "login" --column todo   # filter by column
kanbamd search "login" --limit 5       # max results (default: 10)
kanbamd search "fix" -t bug -c todo,doing -l 20
```

Tag filtering is AND-based: the card must have all specified tags.

### Interactive fallback

Commands that accept an optional `<id>` argument (`view`, `move`, `delete`) show an interactive select list when no ID is given. The picker displays: `[column] Title #id #tag1 #tag2`.

Pressing Ctrl+C during any interactive prompt exits cleanly with "Cancelled."

### File Structure

Each column is a directory. Each card is a `.md` file named `<id>.md`:

```
<board-root>/
├── todo/
│   ├── fix-login.md
│   └── add-dark-mode.md
├── doing/
│   └── refactor-auth.md
├── done/
│   └── setup-ci.md
```

### Card Frontmatter

Every card file has YAML frontmatter:

```markdown
---
title: Fix login
tags: [bug, ui]
order: 1
priority: high
assignee: alice
estimate: 5
---
The card body text.
```

**Reserved fields** (always present):

| Field | Type | Description |
|---|---|---|
| `title` | string | Card title (required, non-empty) |
| `tags` | string[] | List of tags |
| `order` | integer | 1-based position within the column |

**Custom fields** are user-defined during `kanbamd init` and stored as additional frontmatter keys. The reserved keys (`title`, `tags`, `order`) cannot be used as custom field names.

### Custom Fields

Defined interactively during `kanbamd init` (skip with `--no-fields`) and stored in `.kanbamd.json` under `"fields"`. Four types are supported:

| Type | Input | Example |
|---|---|---|
| `text` | Free text input | `assignee`, `branch` |
| `select` | Single-choice from a list | `priority` (low/medium/high) |
| `multiselect` | Multi-choice checkboxes | `labels` (frontend/backend/devops) |
| `number` | Integer with optional min/max | `estimate`, `story-points` |

Each field can be marked `required` and can have a `default` value. During `kanbamd add`, the user is prompted for each custom field according to its type.

### kanbamd.json

The `.kanbamd.json` config file is created by `kanbamd init` in the current directory. It is discovered by walking up the directory tree, so commands work from any subdirectory.

```json
{
  "root": "./board",
  "columns": ["todo", "doing", "done"],
  "fields": [
    { "name": "priority", "type": "select", "options": ["low", "medium", "high"], "required": true },
    { "name": "assignee", "type": "text", "default": "unassigned" },
    { "name": "estimate", "type": "number", "min": 1, "max": 100 },
    { "name": "labels", "type": "multiselect", "options": ["frontend", "backend", "devops"] }
  ]
}
```

| Key | Type | Description |
|---|---|---|
| `root` | string | Path to the board root directory, relative to the config file location |
| `columns` | string[] | Ordered list of column names (each becomes a subdirectory) |
| `fields` | FieldConfig[] | Optional array of custom field definitions |

### ID generation

Card IDs are slugs derived from the title (lowercase, strict, trimmed). Duplicate IDs get a numeric suffix: `my-card`, `my-card-2`, `my-card-3`, etc.
