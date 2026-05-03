# @alejandrocantero/kanbamd

TypeScript package for managing Kanban boards stored as Markdown files with frontmatter and column folders.

## Install

```sh
npm install @alejandrocantero/kanbamd
```

## Board Layout

```txt
board/
  todo/
    fix-login.md
  doing/
  done/
```

Each card is a `.md` file:

```md
---
title: Fix login
tags:
  - bug
order: 1
priority: high
---

Markdown body.
```

## Usage

```ts
import { Kanbamd } from "@alejandrocantero/kanbamd";

type ProjectFields = {
  priority?: "low" | "medium" | "high";
};

const board = new Kanbamd<ProjectFields>({
  root: "./board",
  columns: ["todo", "doing", "done"],
  createRoot: false,
  createColumns: true
});

await board.init();

const card = await board.createCard("todo", {
  title: "Fix login",
  tags: ["bug"],
  body: "OAuth callback fails.",
  frontmatter: {
    priority: "high"
  }
});

await board.moveCard(
  { column: "todo", id: card.id },
  { column: "doing" }
);

await board.reorderCard({ column: "doing", id: card.id }, 0);

const results = await board.searchCards({
  query: "logn callback",
  tags: ["bug"]
});
```

## Memory Storage

```ts
const board = new Kanbamd({
  storage: "memory",
  columns: ["todo", "doing", "done"]
});

await board.init();
```

## Reserved Frontmatter

These fields are managed by Kanbamd and cannot be provided through custom frontmatter:

- `title`
- `tags`
- `order`

Filesystem metadata is exposed as `createdAt` and `updatedAt`.

## CLI

The package ships with a `kanbamd` command-line interface.

### Global install

```sh
npm install -g @alejandrocantero/kanbamd
```

### Quick start

```sh
# Create a board with three columns in the current directory
kanbamd init --columns todo,doing,done

# List columns and their card counts
kanbamd columns

# Add a card interactively (prompts for column, title, body, tags, order)
kanbamd add

# List all cards
kanbamd list

# List cards in a specific column
kanbamd list --column todo

# View a card (interactive picker if no ID is given)
kanbamd view
kanbamd view my-card-slug --column todo

# Move a card to another column (interactive)
kanbamd move

# Delete a card (interactive, with confirmation)
kanbamd delete

# Fuzzy-search cards
kanbamd search "login bug"
kanbamd search "auth" --column todo,doing --tags bug --limit 5
```

### Board config

`kanbamd init` writes a `.kanbamd.json` file to the current directory:

```json
{
  "root": ".",
  "columns": ["todo", "doing", "done"]
}
```

All commands look for this file by walking up the directory tree. You can also override root and columns ad-hoc:

```sh
kanbamd --root ./board --columns todo,doing,done list
```

### Command reference

| Command | Description |
|---|---|
| `init [--root <path>] [--columns <cols>]` | Initialize a board and write `.kanbamd.json` |
| `columns` | List columns with card counts |
| `list [-c <col>]` | List all cards, optionally filtered by column |
| `add` | Interactively create a card (title, body, tags, order) |
| `view [id] [-c <col>]` | Show card details; launches picker if ID omitted |
| `move [id] [-c <col>] [--to <col>]` | Move a card to another column |
| `delete [id] [-c <col>]` | Delete a card with confirmation |
| `search <query> [-c <cols>] [-t <tags>] [-l <n>]` | Fuzzy-search cards |
