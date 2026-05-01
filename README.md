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

## Release

```sh
bun run release fix
bun run release minor
bun run release preminor --preid beta --tag beta
```

The release script checks that the working tree is clean, runs lint/typecheck/tests, updates the
package version, builds `dist`, and publishes to npm. Use `--dry-run` to verify the npm package
without publishing.
