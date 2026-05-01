import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { InvalidFrontmatterError, Kanbamd } from "@src/index"
import { describe, expect, it } from "vitest"

type ProjectFields = {
  priority?: "low" | "medium" | "high"
}

describe("Kanbamd memory storage", () => {
  it("creates cards with unique slugs and automatic order", async () => {
    const board = new Kanbamd<ProjectFields>({
      storage: "memory",
      columns: ["todo", "doing"],
    })

    await board.init()

    const first = await board.createCard("todo", {
      title: "Fix Login",
      tags: ["bug"],
      body: "The login flow is broken.",
      frontmatter: { priority: "high" },
    })
    const second = await board.createCard("todo", {
      title: "Fix Login",
      tags: ["bug"],
    })

    expect(first.id).toBe("fix-login")
    expect(second.id).toBe("fix-login-2")
    expect(first.frontmatter.order).toBe(1)
    expect(second.frontmatter.order).toBe(2)
    expect(first.frontmatter.priority).toBe("high")
  })

  it("updates cards without allowing reserved frontmatter writes", async () => {
    const board = new Kanbamd<ProjectFields>({
      storage: "memory",
      columns: ["todo"],
    })

    await board.init()
    await board.createCard("todo", {
      title: "Refactor API",
      tags: ["tech-debt"],
      body: "Old body",
    })

    const updated = await board.updateCard(
      { column: "todo", id: "refactor-api" },
      {
        title: "Refactor API Client",
        tags: ["tech-debt", "api"],
        body: "New body",
        frontmatter: { priority: "medium" },
      },
    )

    expect(updated.frontmatter.title).toBe("Refactor API Client")
    expect(updated.frontmatter.tags).toEqual(["tech-debt", "api"])
    expect(updated.body).toBe("New body\n")
    expect(updated.frontmatter.priority).toBe("medium")

    await expect(
      board.updateCard(
        { column: "todo", id: "refactor-api" },
        { frontmatter: { order: 10 } as never },
      ),
    ).rejects.toBeInstanceOf(InvalidFrontmatterError)
  })

  it("rejects invalid card input before writing", async () => {
    const board = new Kanbamd({
      storage: "memory",
      columns: ["todo"],
    })

    await board.init()

    await expect(board.createCard("todo", { title: "", tags: [] })).rejects.toBeInstanceOf(
      InvalidFrontmatterError,
    )
    await expect(board.getCard({ column: "todo", id: "../escape" })).rejects.toThrow(
      "Invalid card id",
    )
    await expect(board.listCards({ column: "todo" })).resolves.toEqual([])
  })

  it("moves and reorders cards while normalizing integer order", async () => {
    const board = new Kanbamd({
      storage: "memory",
      columns: ["todo", "doing"],
    })

    await board.init()
    await board.createCard("todo", { title: "First", tags: [] })
    await board.createCard("todo", { title: "Second", tags: [] })
    await board.createCard("todo", { title: "Third", tags: [] })

    await board.reorderCard({ column: "todo", id: "third" }, 0)
    let todo = await board.listCards({ column: "todo" })
    expect(todo.map((card) => [card.id, card.frontmatter.order])).toEqual([
      ["third", 1],
      ["first", 2],
      ["second", 3],
    ])

    const moved = await board.moveCard({ column: "todo", id: "first" }, { column: "doing" })
    expect(moved.column).toBe("doing")
    expect(moved.frontmatter.order).toBe(1)

    todo = await board.listCards({ column: "todo" })
    expect(todo.map((card) => [card.id, card.frontmatter.order])).toEqual([
      ["third", 1],
      ["second", 2],
    ])
  })

  it("searches cards fuzzily and filters by tags", async () => {
    const board = new Kanbamd({
      storage: "memory",
      columns: ["todo", "done"],
    })

    await board.init()
    await board.createCard("todo", {
      title: "Login regression",
      tags: ["bug"],
      body: "OAuth callback fails.",
    })
    await board.createCard("done", {
      title: "Marketing copy",
      tags: ["content"],
      body: "Landing page text.",
    })

    const results = await board.searchCards({
      query: "logn regresion",
      tags: ["bug"],
    })

    expect(results.map((card) => card.id)).toEqual(["login-regression"])
  })
})

describe("Kanbamd filesystem storage", () => {
  it("requires an existing root unless createRoot is enabled and creates columns", async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "kanbamd-"))
    const root = path.join(tmpRoot, "board")

    const failingBoard = new Kanbamd({
      root,
      columns: ["todo"],
    })
    await expect(failingBoard.init()).rejects.toThrow(`Board root does not exist: ${root}`)

    await mkdir(root)
    const board = new Kanbamd({
      root,
      columns: ["todo", "doing"],
      createColumns: true,
    })

    await board.init()
    const card = await board.createCard("todo", {
      title: "Write docs",
      tags: ["docs"],
      body: "Add README.",
    })

    expect(card.id).toBe("write-docs")
    await expect(board.getCard({ column: "todo", id: "write-docs" })).resolves.toMatchObject({
      id: "write-docs",
      column: "todo",
    })
  })

  it("throws InvalidFrontmatterError for malformed markdown cards", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "kanbamd-"))
    await mkdir(path.join(root, "todo"))
    await writeFile(
      path.join(root, "todo", "broken.md"),
      "---\ntags: []\norder: 1\n---\nBody",
      "utf8",
    )

    const board = new Kanbamd({
      root,
      columns: ["todo"],
    })

    await board.init()

    await expect(board.listCards({ column: "todo" })).rejects.toBeInstanceOf(
      InvalidFrontmatterError,
    )
  })
})
