import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { BoardRootNotFoundError, CardNotFoundError } from "./errors.js"

export type StoredFile = {
  content: string
  createdAt: Date
  updatedAt: Date
}

export interface StorageAdapter {
  init(options: {
    root?: string
    columns: string[]
    createRoot: boolean
    createColumns: boolean
  }): Promise<void>
  listMarkdownFiles(column: string): Promise<string[]>
  readCard(column: string, fileName: string): Promise<StoredFile>
  writeCard(column: string, fileName: string, content: string): Promise<StoredFile>
  moveCard(
    from: { column: string; fileName: string },
    to: { column: string; fileName: string },
  ): Promise<void>
  deleteCard(column: string, fileName: string): Promise<void>
}

export class FilesystemStorage implements StorageAdapter {
  async init(options: {
    root?: string
    columns: string[]
    createRoot: boolean
    createColumns: boolean
  }): Promise<void> {
    const root = options.root
    if (!root) {
      throw new BoardRootNotFoundError("Filesystem storage requires a root directory.")
    }

    try {
      const rootStat = await stat(root)
      if (!rootStat.isDirectory()) {
        throw new BoardRootNotFoundError(`Board root is not a directory: ${root}`)
      }
    } catch (error) {
      if (options.createRoot) {
        await mkdir(root, { recursive: true })
      } else {
        throw new BoardRootNotFoundError(`Board root does not exist: ${root}`)
      }
    }

    if (options.createColumns) {
      await Promise.all(
        options.columns.map((column) => mkdir(path.join(root, column), { recursive: true })),
      )
    }
  }

  async listMarkdownFiles(column: string): Promise<string[]> {
    const entries = await readdir(column, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
  }

  async readCard(column: string, fileName: string): Promise<StoredFile> {
    const filePath = path.join(column, fileName)
    try {
      const [content, fileStat] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)])
      return {
        content,
        createdAt: fileStat.birthtime,
        updatedAt: fileStat.mtime,
      }
    } catch {
      throw new CardNotFoundError(`Card file not found: ${filePath}`)
    }
  }

  async writeCard(column: string, fileName: string, content: string): Promise<StoredFile> {
    const filePath = path.join(column, fileName)
    await writeFile(filePath, content, "utf8")
    const fileStat = await stat(filePath)
    return {
      content,
      createdAt: fileStat.birthtime,
      updatedAt: fileStat.mtime,
    }
  }

  async moveCard(
    from: { column: string; fileName: string },
    to: { column: string; fileName: string },
  ): Promise<void> {
    await rename(path.join(from.column, from.fileName), path.join(to.column, to.fileName))
  }

  async deleteCard(column: string, fileName: string): Promise<void> {
    await rm(path.join(column, fileName))
  }
}

export class MemoryStorage implements StorageAdapter {
  private readonly columns = new Map<string, Map<string, StoredFile>>()

  async init(options: { columns: string[] }): Promise<void> {
    for (const column of options.columns) {
      if (!this.columns.has(column)) {
        this.columns.set(column, new Map())
      }
    }
  }

  async listMarkdownFiles(column: string): Promise<string[]> {
    return [...(this.columns.get(column)?.keys() ?? [])].filter((fileName) =>
      fileName.endsWith(".md"),
    )
  }

  async readCard(column: string, fileName: string): Promise<StoredFile> {
    const file = this.columns.get(column)?.get(fileName)
    if (!file) {
      throw new CardNotFoundError(`Card file not found: ${column}/${fileName}`)
    }
    return { ...file, createdAt: new Date(file.createdAt), updatedAt: new Date(file.updatedAt) }
  }

  async writeCard(column: string, fileName: string, content: string): Promise<StoredFile> {
    const files = this.columns.get(column)
    if (!files) {
      throw new CardNotFoundError(`Column not found: ${column}`)
    }

    const existing = files.get(fileName)
    const now = new Date()
    const file = {
      content,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    files.set(fileName, file)
    return { ...file }
  }

  async moveCard(
    from: { column: string; fileName: string },
    to: { column: string; fileName: string },
  ): Promise<void> {
    const source = this.columns.get(from.column)
    const target = this.columns.get(to.column)
    const file = source?.get(from.fileName)
    if (!source || !target || !file) {
      throw new CardNotFoundError(`Card file not found: ${from.column}/${from.fileName}`)
    }

    source.delete(from.fileName)
    target.set(to.fileName, { ...file, updatedAt: new Date() })
  }

  async deleteCard(column: string, fileName: string): Promise<void> {
    const deleted = this.columns.get(column)?.delete(fileName)
    if (!deleted) {
      throw new CardNotFoundError(`Card file not found: ${column}/${fileName}`)
    }
  }
}
