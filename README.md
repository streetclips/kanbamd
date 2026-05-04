# @alejandrocantero/kanbamd

TypeScript library and CLI for managing Kanban boards stored as Markdown files with YAML frontmatter in column directories.

## Install

```sh
npm install @alejandrocantero/kanbamd
```

### Global CLI install

```sh
npm install -g @alejandrocantero/kanbamd
```

## Board Layout

Each column is a directory. Each card is a `.md` file:

```
board/
├── todo/
│   └── fix-login.md
├── doing/
│   └── refactor-auth.md
└── done/
```

A card file:

```markdown
---
title: Fix login
tags: [bug]
order: 1
priority: high
assignee: alice
---
OAuth callback fails when redirect_uri has a trailing slash.
```

**Reserved frontmatter fields** (managed by kanbamd, cannot be used as custom fields):

| Field | Type | Description |
|---|---|---|
| `title` | `string` | Card title (required) |
| `tags` | `string[]` | List of tags |
| `order` | `integer` | 1-based position within column |

Filesystem metadata is exposed as `createdAt` (birthtime) and `updatedAt` (mtime).

## SDK

### Setup

```ts
import { Kanbamd } from "@alejandrocantero/kanbamd";

const board = new Kanbamd({
  root: "./board",
  columns: ["todo", "doing", "done"],
  createRoot: false,       // default: false — create root dir if missing
  createColumns: true,     // default: true  — create column dirs inside root
});

await board.init();
```

#### Memory storage

In-memory storage for testing or programmatic use (no filesystem required):

```ts
const board = new Kanbamd({
  storage: "memory",
  columns: ["todo", "doing", "done"],
});

await board.init();
```

### Typed custom fields

Pass a type parameter to constrain custom frontmatter fields:

```ts
type CustomFields = {
  priority?: "low" | "medium" | "high";
  assignee?: string;
  estimate?: number;
};

const board = new Kanbamd<CustomFields>({
  root: "./board",
  columns: ["todo", "doing", "done"],
});
```

### API

#### `listColumns()`

```ts
const columns: string[] = await board.listColumns();
```

#### `listCards(options?)`

```ts
const allCards = await board.listCards();
const todoCards = await board.listCards({ column: "todo" });
```

Returns `Card<T>[]` sorted by column then order.

#### `getCard(locator)`

```ts
const card = await board.getCard({ column: "todo", id: "fix-login" });
```

`Card<T>` shape:

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Slug derived from title |
| `fileName` | `string` | `"<id>.md"` |
| `column` | `string` | Column the card belongs to |
| `frontmatter` | `CardFrontmatter<T>` | Parsed YAML frontmatter |
| `body` | `string` | Markdown body |
| `createdAt` | `Date` | Filesystem birthtime |
| `updatedAt` | `Date` | Filesystem mtime |

#### `createCard(column, input)`

```ts
const card = await board.createCard("todo", {
  title: "Fix login",
  tags: ["bug"],
  body: "OAuth callback fails.",
  frontmatter: {
    priority: "high",
    assignee: "alice",
  },
});
```

`CreateCardInput<T>`:

| Field | Type | Default | Description |
|---|---|---|---|
| `title` | `string` | _required_ | Card title |
| `tags` | `string[]` | `[]` | Tags |
| `body` | `string` | `""` | Markdown body |
| `frontmatter` | `NoReservedFrontmatter<T>` | — | Custom fields |

Duplicate IDs get a numeric suffix: `fix-login`, `fix-login-2`, `fix-login-3`, etc.

#### `updateCard(locator, input)`

```ts
const updated = await board.updateCard(
  { column: "todo", id: "fix-login" },
  {
    title: "Fix OAuth redirect",
    tags: ["bug", "auth"],
    body: "Updated description.",
    frontmatter: { priority: "medium" },
  }
);
```

All fields in `UpdateCardInput<T>` are optional. Omitted fields keep their current value.

#### `moveCard(locator, target)`

```ts
await board.moveCard(
  { column: "todo", id: "fix-login" },
  { column: "doing" }
);
```

The source column's order is normalized (1, 2, 3, ...). The moved card is placed last in the target column. Throws `DuplicateCardError` if a card with the same ID already exists in the target column.

#### `reorderCard(locator, index)`

```ts
const reordered = await board.reorderCard(
  { column: "todo", id: "fix-login" },
  0   // 0-based new position
);
```

Returns the entire column's cards in their new order. Out-of-range indices are clamped.

#### `deleteCard(locator)`

```ts
await board.deleteCard({ column: "todo", id: "fix-login" });
```

The column's remaining cards are normalized.

#### `searchCards(options)`

```ts
const results = await board.searchCards({
  query: "oauth redirect",
  columns: ["todo", "doing"],
  tags: ["bug"],
  limit: 10,
});
```

Fuzzy search (Fuse.js, threshold: 0.35, ignoreLocation: true) across `id`, `frontmatter.title`, `frontmatter.tags`, and `body`. Tag filtering is AND-based.

### Error classes

| Error | When |
|---|---|
| `BoardRootNotFoundError` | Root dir missing or not a directory |
| `ColumnNotFoundError` | Column not in the defined list |
| `CardNotFoundError` | Card file or ID not found |
| `DuplicateCardError` | ID collision during move |
| `InvalidFrontmatterError` | Invalid/reserved key in frontmatter |
| `InvalidStorageConfigurationError` | Misconfigured storage options |

All extend `KanbamdError`.

## CLI

The `kanbamd` binary ships with the package.

### `kanbamd init`

Initialize a board. Creates column directories and a `.kanbamd.json` config.

```sh
kanbamd init
kanbamd init --no-fields                         # skip custom field prompts
kanbamd init --root ./board --columns todo,doing,done
```

By default, `init` prompts interactively to define custom frontmatter fields. Four field types are supported:

| Type | Input | Example |
|---|---|---|
| `text` | Free text | `assignee`, `branch` |
| `select` | Single choice | `priority` (low/medium/high) |
| `multiselect` | Checkboxes | `labels` (frontend, backend, devops) |
| `number` | Integer with min/max | `estimate`, `story-points` |

Each can be marked required and have a default value.

### `kanbamd columns`

```sh
kanbamd columns
```

Lists columns with card counts.

### `kanbamd list`

```sh
kanbamd list
kanbamd list --column todo
kanbamd list -c todo
```

Cards shown as: `<order>. [<column>] <title> #<id> #<tag1> #<tag2>`

### `kanbamd add`

Fully interactive. Prompts for: column (skipped if only one exists), title (required), body, tags (comma-separated), custom fields (if defined in config), and order (defaults to last).

```sh
kanbamd add
```

### `kanbamd view`

```sh
kanbamd view fix-login                            # by ID
kanbamd view fix-login --column todo              # disambiguate
kanbamd view                                      # interactive picker
```

Displays: title, ID, column, order, tags, all custom fields, `createdAt`, `updatedAt`, and body.

### `kanbamd move`

```sh
kanbamd move fix-login --to done                  # non-interactive
kanbamd move                                      # interactive picker
```

The target is auto-selected if only one other column exists.

### `kanbamd delete`

```sh
kanbamd delete fix-login                          # by ID
kanbamd delete                                    # interactive picker
```

Always prompts for confirmation.

### `kanbamd search`

```sh
kanbamd search "oauth bug"
kanbamd search "oauth" --tags bug,auth            # must have ALL tags
kanbamd search "oauth" --column todo,doing        # filter columns
kanbamd search "oauth" --limit 5                  # max results (default: 10)
kanbamd search "fix" -t bug -c todo,doing -l 20
```

### Global options

These apply before any subcommand and override config:

```sh
kanbamd --root ./board --columns todo,doing,done list
```

If omitted, kanbamd walks up the directory tree looking for `.kanbamd.json`. Falls back to the current directory, auto-detecting columns from subdirectories.

### Interactive fallback

Commands accepting an optional `<id>` (`view`, `move`, `delete`) show a select list when called without one. Ctrl+C exits cleanly.

## Configuration

`kanbamd init` writes a `.kanbamd.json` file:

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
| `root` | `string` | Path to board root, relative to this file |
| `columns` | `string[]` | Ordered column names |
| `fields` | `FieldConfig[]` | Custom field definitions (optional) |

Config is discovered by walking up from the working directory, so commands work from any subdirectory.
