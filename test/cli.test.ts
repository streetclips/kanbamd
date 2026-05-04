import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { cardChoice, detectColumns, findConfigPath } from "../src/cli.js"
import type { Card } from "../src/types.js"

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "test-card",
    fileName: "test-card.md",
    column: "todo",
    frontmatter: {
      title: "Test Card",
      tags: ["bug", "ui"],
      order: 1,
    },
    body: "Some body text",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-02"),
    ...overrides,
  }
}

describe("cardChoice", () => {
  it("returns name and value for a card with tags", () => {
    const card = makeCard()
    const result = cardChoice(card)

    expect(result.value).toBe(card)
    expect(result.name).toContain("[todo]")
    expect(result.name).toContain("Test Card")
    expect(result.name).toContain("#test-card")
    expect(result.name).toContain("#bug")
    expect(result.name).toContain("#ui")
  })

  it("formats a card without tags", () => {
    const card = makeCard({ frontmatter: { title: "No Tags", tags: [], order: 1 } })
    const result = cardChoice(card)

    expect(result.name).not.toContain("#bug")
    expect(result.name).not.toContain("#ui")
  })
})

describe("findConfigPath", () => {
  it("returns null when no .kanbamd.json exists in the tree", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kanbamd-"))
    const result = await findConfigPath(dir)
    expect(result).toBeNull()
  })

  it("finds .kanbamd.json in the current directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kanbamd-"))
    const configPath = path.join(dir, ".kanbamd.json")
    await writeFile(configPath, JSON.stringify({ root: ".", columns: ["todo"] }))

    const result = await findConfigPath(dir)
    expect(result).toBe(configPath)
  })

  it("finds .kanbamd.json in a parent directory", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "kanbamd-"))
    const configPath = path.join(parent, ".kanbamd.json")
    await writeFile(configPath, JSON.stringify({ root: ".", columns: ["todo"] }))

    const child = path.join(parent, "deeply", "nested")
    await mkdir(child, { recursive: true })

    const result = await findConfigPath(child)
    expect(result).toBe(configPath)
  })

  it("returns null when no config exists even in parent chain", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "kanbamd-"))
    const child = path.join(parent, "deeply", "nested")
    await mkdir(child, { recursive: true })

    const result = await findConfigPath(child)
    expect(result).toBeNull()
  })
})

describe("detectColumns", () => {
  it("returns sorted non-dot subdirectories", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kanbamd-"))
    await mkdir(path.join(dir, "done"))
    await mkdir(path.join(dir, "doing"))
    await mkdir(path.join(dir, "todo"))

    const columns = await detectColumns(dir)
    expect(columns).toEqual(["doing", "done", "todo"])
  })

  it("ignores dot-prefixed directories", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kanbamd-"))
    await mkdir(path.join(dir, ".git"))
    await mkdir(path.join(dir, ".github"))
    await mkdir(path.join(dir, "todo"))
    await mkdir(path.join(dir, ".hidden"))

    const columns = await detectColumns(dir)
    expect(columns).toEqual(["todo"])
  })

  it("returns empty array for empty directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kanbamd-"))
    const columns = await detectColumns(dir)
    expect(columns).toEqual([])
  })

  it("returns empty array when directory does not exist", async () => {
    const columns = await detectColumns("/non/existent/path")
    expect(columns).toEqual([])
  })

  it("ignores files, only returns directories", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kanbamd-"))
    await writeFile(path.join(dir, "readme.md"), "# Readme")
    await mkdir(path.join(dir, "todo"))

    const columns = await detectColumns(dir)
    expect(columns).toEqual(["todo"])
  })
})
