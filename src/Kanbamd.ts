import path from "node:path"
import Fuse from "fuse.js"
import {
  CardNotFoundError,
  ColumnNotFoundError,
  DuplicateCardError,
  InvalidStorageConfigurationError,
} from "./errors.js"
import {
  createSlug,
  parseCardFrontmatter,
  stringifyCard,
  toFileName,
  toId,
  validateCardId,
  validateColumnName,
  validateExtraFrontmatter,
  validateTags,
  validateTitle,
} from "./helpers.js"
import { FilesystemStorage, MemoryStorage, type StorageAdapter } from "./storage.js"
import type {
  Card,
  CardFrontmatter,
  CardLocator,
  CreateCardInput,
  ExtraFrontmatter,
  KanbamdOptions,
  ListCardsOptions,
  SearchCardsOptions,
  UpdateCardInput,
} from "./types.js"

const defaultOrderStep = 1

export class Kanbamd<T extends ExtraFrontmatter = ExtraFrontmatter> {
  private readonly root?: string
  private readonly columns: string[]
  private readonly createRoot: boolean
  private readonly createColumns: boolean
  private readonly storage: StorageAdapter
  private writeQueue = Promise.resolve()
  private initialized = false

  constructor(options: KanbamdOptions) {
    const storageKind = options.storage ?? "filesystem"
    this.root = options.root
    this.columns = [...options.columns]
    this.createRoot = options.createRoot ?? false
    this.createColumns = options.createColumns ?? true

    if (this.columns.length === 0) {
      throw new ColumnNotFoundError("At least one column must be defined.")
    }

    for (const column of this.columns) {
      validateColumnName(column)
    }

    if (storageKind === "filesystem" && !this.root) {
      throw new InvalidStorageConfigurationError("Filesystem storage requires a root option.")
    }

    if (storageKind === "memory" && !this.root && options.createRoot) {
      throw new InvalidStorageConfigurationError(
        "createRoot is only meaningful when a root is provided.",
      )
    }

    this.storage = storageKind === "memory" ? new MemoryStorage() : new FilesystemStorage()
  }

  async init(): Promise<void> {
    await this.storage.init({
      root: this.root,
      columns: this.columns,
      createRoot: this.createRoot,
      createColumns: this.createColumns,
    })
    this.initialized = true
  }

  async listColumns(): Promise<string[]> {
    this.assertInitialized()
    return [...this.columns]
  }

  async listCards(options: ListCardsOptions = {}): Promise<Card<T>[]> {
    this.assertInitialized()
    const columns = options.column ? [this.assertColumn(options.column)] : this.columns
    const cards = await Promise.all(columns.map((column) => this.listColumnCards(column)))
    return cards
      .flat()
      .sort((a, b) => a.column.localeCompare(b.column) || a.frontmatter.order - b.frontmatter.order)
  }

  async getCard(locator: CardLocator): Promise<Card<T>> {
    this.assertInitialized()
    const column = this.assertColumn(locator.column)
    validateCardId(locator.id)
    return this.readCard(column, toFileName(locator.id))
  }

  async createCard(columnInput: string, input: CreateCardInput<T>): Promise<Card<T>> {
    this.assertInitialized()
    const column = this.assertColumn(columnInput)
    validateTitle(input.title)
    validateTags(input.tags ?? [])
    validateExtraFrontmatter(input.frontmatter)

    return this.enqueueWrite(async () => {
      const existingCards = await this.listColumnCards(column)
      const id = this.nextAvailableId(input.title, existingCards)
      const fileName = toFileName(id)
      const frontmatter = {
        title: input.title,
        tags: input.tags ?? [],
        order: existingCards.length + defaultOrderStep,
        ...(input.frontmatter ?? {}),
      } as CardFrontmatter<T>

      const stored = await this.storage.writeCard(
        this.columnPath(column),
        fileName,
        stringifyCard(frontmatter, input.body ?? ""),
      )
      return this.toCard(column, fileName, stored.content, stored.createdAt, stored.updatedAt)
    })
  }

  async updateCard(locator: CardLocator, input: UpdateCardInput<T>): Promise<Card<T>> {
    this.assertInitialized()
    validateExtraFrontmatter(input.frontmatter)
    const column = this.assertColumn(locator.column)
    validateCardId(locator.id)
    if (input.title !== undefined) {
      validateTitle(input.title)
    }
    if (input.tags !== undefined) {
      validateTags(input.tags)
    }
    const fileName = toFileName(locator.id)

    return this.enqueueWrite(async () => {
      const card = await this.readCard(column, fileName)
      const nextFrontmatter = {
        ...card.frontmatter,
        ...(input.frontmatter ?? {}),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.tags === undefined ? {} : { tags: input.tags }),
      } as CardFrontmatter<T>
      const nextBody = input.body ?? card.body
      const stored = await this.storage.writeCard(
        this.columnPath(column),
        fileName,
        stringifyCard(nextFrontmatter, nextBody),
      )
      return this.toCard(column, fileName, stored.content, stored.createdAt, stored.updatedAt)
    })
  }

  async moveCard(locator: CardLocator, target: { column: string }): Promise<Card<T>> {
    this.assertInitialized()
    const fromColumn = this.assertColumn(locator.column)
    const toColumn = this.assertColumn(target.column)
    validateCardId(locator.id)
    const fileName = toFileName(locator.id)

    return this.enqueueWrite(async () => {
      const sourceCard = await this.readCard(fromColumn, fileName)
      const targetFileNames = await this.storage.listMarkdownFiles(this.columnPath(toColumn))
      if (targetFileNames.includes(fileName)) {
        throw new DuplicateCardError(
          `Card already exists in target column: ${toColumn}/${locator.id}`,
        )
      }

      await this.storage.moveCard(
        { column: this.columnPath(fromColumn), fileName },
        { column: this.columnPath(toColumn), fileName },
      )

      await this.normalizeColumnOrder(fromColumn)
      const targetCards = await this.listColumnCards(toColumn)
      const moved = targetCards.find((card) => card.id === locator.id)
      if (!moved) {
        throw new CardNotFoundError(`Moved card not found: ${toColumn}/${locator.id}`)
      }

      const nextFrontmatter = {
        ...sourceCard.frontmatter,
        order: targetCards.length,
      }
      const stored = await this.storage.writeCard(
        this.columnPath(toColumn),
        fileName,
        stringifyCard(nextFrontmatter, moved.body),
      )
      return this.toCard(toColumn, fileName, stored.content, stored.createdAt, stored.updatedAt)
    })
  }

  async reorderCard(locator: CardLocator, index: number): Promise<Card<T>[]> {
    this.assertInitialized()
    const column = this.assertColumn(locator.column)
    validateCardId(locator.id)
    const targetIndex = Math.max(0, Math.floor(index))

    return this.enqueueWrite(async () => {
      const cards = await this.listColumnCards(column)
      const currentIndex = cards.findIndex((card) => card.id === locator.id)
      if (currentIndex === -1) {
        throw new CardNotFoundError(`Card not found: ${column}/${locator.id}`)
      }

      const [card] = cards.splice(currentIndex, 1)
      cards.splice(Math.min(targetIndex, cards.length), 0, card)
      await this.writeOrderedCards(column, cards)
      return this.listColumnCards(column)
    })
  }

  async deleteCard(locator: CardLocator): Promise<void> {
    this.assertInitialized()
    const column = this.assertColumn(locator.column)
    validateCardId(locator.id)
    const fileName = toFileName(locator.id)

    return this.enqueueWrite(async () => {
      await this.storage.deleteCard(this.columnPath(column), fileName)
      await this.normalizeColumnOrder(column)
    })
  }

  async searchCards(options: SearchCardsOptions): Promise<Card<T>[]> {
    this.assertInitialized()
    const cards = await this.listCards()
    const allowedColumns = options.columns
      ? new Set(options.columns.map((column) => this.assertColumn(column)))
      : undefined
    const requiredTags = options.tags ? new Set(options.tags) : undefined
    const filteredCards = cards.filter((card) => {
      if (allowedColumns && !allowedColumns.has(card.column)) {
        return false
      }

      if (requiredTags && ![...requiredTags].every((tag) => card.frontmatter.tags.includes(tag))) {
        return false
      }

      return true
    })

    const fuse = new Fuse(filteredCards, {
      keys: ["id", "frontmatter.title", "frontmatter.tags", "body"],
      threshold: 0.35,
      ignoreLocation: true,
    })

    return fuse.search(options.query, { limit: options.limit }).map((result) => result.item)
  }

  private async listColumnCards(column: string): Promise<Card<T>[]> {
    const fileNames = await this.storage.listMarkdownFiles(this.columnPath(column))
    const cards = await Promise.all(fileNames.map((fileName) => this.readCard(column, fileName)))
    return cards.sort(
      (a, b) => a.frontmatter.order - b.frontmatter.order || a.id.localeCompare(b.id),
    )
  }

  private async readCard(column: string, fileName: string): Promise<Card<T>> {
    const stored = await this.storage.readCard(this.columnPath(column), fileName)
    return this.toCard(column, fileName, stored.content, stored.createdAt, stored.updatedAt)
  }

  private toCard(
    column: string,
    fileName: string,
    content: string,
    createdAt: Date,
    updatedAt: Date,
  ): Card<T> {
    const parsed = parseCardFrontmatter<T>(content, fileName)
    return {
      id: toId(fileName),
      fileName,
      column,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      createdAt,
      updatedAt,
    }
  }

  private nextAvailableId(title: string, existingCards: Card<T>[]): string {
    const baseSlug = createSlug(title)
    const existingIds = new Set(existingCards.map((card) => card.id))
    if (!existingIds.has(baseSlug)) {
      return baseSlug
    }

    for (let suffix = 2; suffix < Number.MAX_SAFE_INTEGER; suffix += 1) {
      const id = `${baseSlug}-${suffix}`
      if (!existingIds.has(id)) {
        return id
      }
    }

    throw new DuplicateCardError(`Could not generate a unique slug for title: ${title}`)
  }

  private async normalizeColumnOrder(column: string): Promise<void> {
    await this.writeOrderedCards(column, await this.listColumnCards(column))
  }

  private async writeOrderedCards(column: string, cards: Card<T>[]): Promise<void> {
    await Promise.all(
      cards.map((card, index) => {
        const frontmatter = {
          ...card.frontmatter,
          order: index + 1,
        }
        return this.storage.writeCard(
          this.columnPath(column),
          card.fileName,
          stringifyCard(frontmatter, card.body),
        )
      }),
    )
  }

  private assertColumn(column: string): string {
    if (!this.columns.includes(column)) {
      throw new ColumnNotFoundError(`Column is not defined: ${column}`)
    }
    return column
  }

  private columnPath(column: string): string {
    return this.root ? path.join(this.root, column) : column
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error("Kanbamd must be initialized with init() before use.")
    }
  }

  private enqueueWrite<R>(operation: () => Promise<R>): Promise<R> {
    const queued = this.writeQueue.then(operation, operation)
    this.writeQueue = queued.then(
      () => undefined,
      () => undefined,
    )
    return queued
  }
}
