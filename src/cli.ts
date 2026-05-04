#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { ExitPromptError } from "@inquirer/core"
import { confirm, input, select } from "@inquirer/prompts"
import chalk from "chalk"
import { Command } from "commander"
import { Kanbamd } from "./index.js"
import type { Card } from "./types.js"

const _require = createRequire(import.meta.url)
const { version } = _require("../package.json") as { version: string }

const CONFIG_FILE = ".kanbamd.json"

type Config = {
  root: string
  columns: string[]
}

export async function findConfigPath(startDir: string): Promise<string | null> {
  let dir = startDir
  while (true) {
    const p = path.join(dir, CONFIG_FILE)
    if (existsSync(p)) {
      return p
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      return null
    }
    dir = parent
  }
}

export async function detectColumns(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

async function resolveBoard(opts: {
  root?: string
  columns?: string
}): Promise<{ board: Kanbamd; config: Config }> {
  let config: Config

  if (opts.root || opts.columns) {
    const root = path.resolve(opts.root ?? process.cwd())
    const columns = opts.columns
      ? opts.columns
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean)
      : await detectColumns(root)
    config = { root, columns }
  } else {
    const configPath = await findConfigPath(process.cwd())
    if (configPath) {
      const configDir = path.dirname(configPath)
      const raw = JSON.parse(await readFile(configPath, "utf-8")) as Config
      config = { ...raw, root: path.resolve(configDir, raw.root) }
    } else {
      const root = process.cwd()
      const columns = await detectColumns(root)
      if (columns.length === 0) {
        console.error(chalk.red("No board found. Run `kanbamd init` to create one."))
        process.exit(1)
      }
      config = { root, columns }
    }
  }

  if (config.columns.length === 0) {
    console.error(chalk.red("No columns found. Specify --columns or run `kanbamd init`."))
    process.exit(1)
  }

  const board = new Kanbamd({
    root: config.root,
    columns: config.columns,
    createRoot: false,
    createColumns: false,
  })
  await board.init()
  return { board, config }
}

function printCardLine(card: Card): void {
  const col = chalk.dim(`[${card.column}]`)
  const title = chalk.bold(card.frontmatter.title)
  const id = chalk.dim(`#${card.id}`)
  const order = chalk.dim(`${card.frontmatter.order}.`)
  const tags =
    card.frontmatter.tags.length > 0
      ? ` ${card.frontmatter.tags.map((t) => chalk.yellow(`#${t}`)).join(" ")}`
      : ""
  console.log(`  ${order} ${col} ${title} ${id}${tags}`)
}

function printCardDetail(card: Card): void {
  console.log()
  console.log(chalk.bold.cyan(`  ${card.frontmatter.title}`))
  console.log(chalk.dim("  ID:      ") + card.id)
  console.log(chalk.dim("  Column:  ") + chalk.cyan(card.column))
  console.log(chalk.dim("  Order:   ") + card.frontmatter.order)
  if (card.frontmatter.tags.length > 0) {
    console.log(
      chalk.dim("  Tags:    ") + card.frontmatter.tags.map((t) => chalk.yellow(`#${t}`)).join(" "),
    )
  }
  console.log(chalk.dim("  Created: ") + card.createdAt.toLocaleDateString())
  console.log(chalk.dim("  Updated: ") + card.updatedAt.toLocaleDateString())
  if (card.body.trim()) {
    console.log()
    for (const line of card.body.trim().split("\n")) {
      console.log(`  ${chalk.white(line)}`)
    }
  }
  console.log()
}

export function cardChoice(card: Card): { name: string; value: Card } {
  const tags =
    card.frontmatter.tags.length > 0
      ? ` ${card.frontmatter.tags.map((t) => chalk.yellow(`#${t}`)).join(" ")}`
      : ""
  return {
    name: `${chalk.dim(`[${card.column}]`)} ${card.frontmatter.title} ${chalk.dim(`#${card.id}`)}${tags}`,
    value: card,
  }
}

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (error) {
    if (error instanceof ExitPromptError) {
      console.log(chalk.dim("\nCancelled."))
      process.exit(0)
    }
    const msg = error instanceof Error ? error.message : String(error)
    console.error(chalk.red("Error:"), msg)
    process.exit(1)
  }
}

const program = new Command()
  .name("kanbamd")
  .description("Manage Kanban boards backed by Markdown files")
  .version(version)
  .option("--root <path>", "board root directory")
  .option("--columns <cols>", "comma-separated column names")

export { program }

// ── init ──────────────────────────────────────────────────────────────────────

program
  .command("init")
  .description("Initialize a new Kanban board in the current directory")
  .option("--root <path>", "board root (default: current directory)")
  .option("--columns <cols>", "comma-separated column names (default: todo,doing,done)")
  .action(async (opts: { root?: string; columns?: string }) =>
    run(async () => {
      const root = path.resolve(opts.root ?? process.cwd())
      const columnsRaw = opts.columns ?? "todo,doing,done"
      const columns = columnsRaw
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)

      const configPath = path.join(process.cwd(), CONFIG_FILE)
      const relativeRoot = path.relative(process.cwd(), root) || "."
      const configData: Config = { root: relativeRoot, columns }

      await writeFile(configPath, `${JSON.stringify(configData, null, 2)}\n`, "utf-8")
      console.log(chalk.green(`✓ Config written to ${CONFIG_FILE}`))

      for (const col of columns) {
        await mkdir(path.join(root, col), { recursive: true })
        console.log(chalk.green(`✓ Created column: ${col}`))
      }

      console.log(chalk.bold("\nBoard initialized!"))
      console.log(`  Root:    ${chalk.cyan(relativeRoot)}`)
      console.log(`  Columns: ${chalk.cyan(columns.join(", "))}`)
      console.log()
    }),
  )

// ── columns ───────────────────────────────────────────────────────────────────

program
  .command("columns")
  .description("List all columns with card counts")
  .action(async () =>
    run(async () => {
      const { board, config } = await resolveBoard(program.opts())
      console.log(chalk.bold("\nColumns:"))
      for (const col of config.columns) {
        const cards = await board.listCards({ column: col })
        const n = cards.length
        console.log(`  ${chalk.cyan(col)} ${chalk.dim(`(${n} card${n !== 1 ? "s" : ""})`)}`)
      }
      console.log()
    }),
  )

// ── list ──────────────────────────────────────────────────────────────────────

program
  .command("list")
  .description("List cards, optionally filtered by column")
  .option("-c, --column <col>", "filter by column")
  .action(async (opts: { column?: string }) =>
    run(async () => {
      const { board } = await resolveBoard(program.opts())
      const cards = await board.listCards(opts.column ? { column: opts.column } : {})

      if (cards.length === 0) {
        console.log(chalk.dim("No cards found."))
        return
      }

      const byColumn: Record<string, Card[]> = {}
      for (const card of cards) {
        byColumn[card.column] ??= []
        byColumn[card.column].push(card)
      }

      for (const [col, colCards] of Object.entries(byColumn)) {
        const n = colCards.length
        console.log(
          chalk.bold(`\n── ${chalk.cyan(col)} ${chalk.dim(`(${n} card${n !== 1 ? "s" : ""})`)} ──`),
        )
        for (const card of colCards) {
          printCardLine(card)
        }
      }
      console.log()
    }),
  )

// ── add ───────────────────────────────────────────────────────────────────────

program
  .command("add")
  .description("Add a new card interactively")
  .action(async () =>
    run(async () => {
      const { board, config } = await resolveBoard(program.opts())

      const column =
        config.columns.length === 1
          ? config.columns[0]
          : await select({
              message: "Select column:",
              choices: config.columns.map((c) => ({
                name: chalk.cyan(c),
                value: c,
              })),
            })

      const title = await input({
        message: "Title:",
        validate: (v) => (v.trim().length > 0 ? true : "Title is required"),
      })

      const bodyRaw = await input({
        message: "Body (optional):",
      })

      const tagsRaw = await input({
        message: "Tags (comma-separated, optional):",
      })
      const tags = tagsRaw.trim()
        ? tagsRaw
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : []

      const orderRaw = await input({
        message: "Order (leave empty to place last):",
        validate: (v) =>
          !v.trim() || /^\d+$/.test(v.trim()) ? true : "Must be a positive integer",
      })

      const card = await board.createCard(column, {
        title: title.trim(),
        body: bodyRaw.trim(),
        tags,
      })

      if (orderRaw.trim()) {
        const targetIndex = Math.max(0, Number.parseInt(orderRaw.trim(), 10) - 1)
        await board.reorderCard({ column, id: card.id }, targetIndex)
        const updated = await board.getCard({ column, id: card.id })
        console.log(chalk.green("\n✓ Card created:"))
        printCardLine(updated)
      } else {
        console.log(chalk.green("\n✓ Card created:"))
        printCardLine(card)
      }
      console.log()
    }),
  )

// ── view ──────────────────────────────────────────────────────────────────────

program
  .command("view [id]")
  .description("View a card in detail (interactive if no ID given)")
  .option("-c, --column <col>", "column of the card")
  .action(async (id: string | undefined, opts: { column?: string }) =>
    run(async () => {
      const { board } = await resolveBoard(program.opts())

      let cardId = id
      let column = opts.column

      if (!cardId) {
        const cards = await board.listCards(column ? { column } : {})
        if (cards.length === 0) {
          console.log(chalk.dim("No cards found."))
          return
        }
        const chosen = await select({
          message: "Select card:",
          choices: cards.map(cardChoice),
        })
        cardId = chosen.id
        column = chosen.column
      }

      if (!column) {
        const cards = await board.listCards()
        const found = cards.find((c) => c.id === cardId)
        if (!found) {
          console.error(chalk.red(`Card not found: ${cardId}`))
          process.exit(1)
        }
        column = found.column
      }

      const card = await board.getCard({ column, id: cardId })
      printCardDetail(card)
    }),
  )

// ── move ──────────────────────────────────────────────────────────────────────

program
  .command("move [id]")
  .description("Move a card to another column (interactive)")
  .option("-c, --column <col>", "current column of the card")
  .option("--to <col>", "target column")
  .action(async (id: string | undefined, opts: { column?: string; to?: string }) =>
    run(async () => {
      const { board, config } = await resolveBoard(program.opts())

      let cardId = id
      let fromColumn = opts.column

      if (!cardId) {
        const cards = await board.listCards(fromColumn ? { column: fromColumn } : {})
        if (cards.length === 0) {
          console.log(chalk.dim("No cards found."))
          return
        }
        const chosen = await select({
          message: "Select card to move:",
          choices: cards.map(cardChoice),
        })
        cardId = chosen.id
        fromColumn = chosen.column
      }

      if (!fromColumn) {
        const cards = await board.listCards()
        const found = cards.find((c) => c.id === cardId)
        if (!found) {
          console.error(chalk.red(`Card not found: ${cardId}`))
          process.exit(1)
        }
        fromColumn = found.column
      }

      const targetCols = config.columns.filter((c) => c !== fromColumn)
      if (targetCols.length === 0) {
        console.error(chalk.red("No other columns to move to."))
        process.exit(1)
      }

      const toColumn =
        opts.to ??
        (targetCols.length === 1
          ? targetCols[0]
          : await select({
              message: "Move to column:",
              choices: targetCols.map((c) => ({
                name: chalk.cyan(c),
                value: c,
              })),
            }))

      const card = await board.moveCard({ column: fromColumn, id: cardId }, { column: toColumn })
      console.log(chalk.green(`\n✓ Moved to ${chalk.cyan(toColumn)}:`))
      printCardLine(card)
      console.log()
    }),
  )

// ── delete ────────────────────────────────────────────────────────────────────

program
  .command("delete [id]")
  .description("Delete a card (interactive)")
  .option("-c, --column <col>", "column of the card")
  .action(async (id: string | undefined, opts: { column?: string }) =>
    run(async () => {
      const { board } = await resolveBoard(program.opts())

      let cardId = id
      let column = opts.column

      if (!cardId) {
        const cards = await board.listCards(column ? { column } : {})
        if (cards.length === 0) {
          console.log(chalk.dim("No cards found."))
          return
        }
        const chosen = await select({
          message: "Select card to delete:",
          choices: cards.map(cardChoice),
        })
        cardId = chosen.id
        column = chosen.column
      }

      if (!column) {
        const cards = await board.listCards()
        const found = cards.find((c) => c.id === cardId)
        if (!found) {
          console.error(chalk.red(`Card not found: ${cardId}`))
          process.exit(1)
        }
        column = found.column
      }

      const card = await board.getCard({ column, id: cardId })
      printCardDetail(card)

      const ok = await confirm({
        message: chalk.red("Delete this card?"),
        default: false,
      })

      if (!ok) {
        console.log(chalk.dim("Cancelled."))
        return
      }

      await board.deleteCard({ column, id: cardId })
      console.log(chalk.green(`\n✓ Deleted: ${cardId}`))
      console.log()
    }),
  )

// ── search ────────────────────────────────────────────────────────────────────

program
  .command("search <query>")
  .description("Search cards with fuzzy matching")
  .option("-c, --column <cols>", "filter by column(s), comma-separated")
  .option("-t, --tags <tags>", "filter by tag(s), comma-separated")
  .option("-l, --limit <n>", "maximum number of results", "10")
  .action(async (query: string, opts: { column?: string; tags?: string; limit: string }) =>
    run(async () => {
      const { board } = await resolveBoard(program.opts())

      const results = await board.searchCards({
        query,
        limit: Number.parseInt(opts.limit, 10),
        ...(opts.column
          ? {
              columns: opts.column
                .split(",")
                .map((c) => c.trim())
                .filter(Boolean),
            }
          : {}),
        ...(opts.tags
          ? {
              tags: opts.tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
            }
          : {}),
      })

      if (results.length === 0) {
        console.log(chalk.dim(`\nNo results for "${query}".`))
        return
      }

      console.log(chalk.bold(`\nResults for "${chalk.cyan(query)}" (${results.length}):`))
      for (const card of results) {
        printCardLine(card)
      }
      console.log()
    }),
  )

const scriptPath = fileURLToPath(import.meta.url)
const isMain = process.argv[1] && realpathSync(process.argv[1]) === scriptPath
if (isMain) {
  program.parse()
}
