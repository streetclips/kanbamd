export type ReservedFrontmatterKey = "title" | "tags" | "order"

export type ExtraFrontmatter = object

export type NoReservedFrontmatter<T extends ExtraFrontmatter> = T & {
  [K in Extract<keyof T, ReservedFrontmatterKey>]: never
}

export type BaseFrontmatter = {
  title: string
  tags: string[]
  order: number
}

export type CardFrontmatter<T extends ExtraFrontmatter = ExtraFrontmatter> = BaseFrontmatter &
  NoReservedFrontmatter<T>

export type Card<T extends ExtraFrontmatter = ExtraFrontmatter> = {
  id: string
  fileName: string
  column: string
  frontmatter: CardFrontmatter<T>
  body: string
  createdAt: Date
  updatedAt: Date
}

export type CardLocator = {
  column: string
  id: string
}

export type CreateCardInput<T extends ExtraFrontmatter = ExtraFrontmatter> = {
  title: string
  tags?: string[]
  body?: string
  frontmatter?: NoReservedFrontmatter<T>
}

export type UpdateCardInput<T extends ExtraFrontmatter = ExtraFrontmatter> = {
  title?: string
  tags?: string[]
  body?: string
  frontmatter?: Partial<NoReservedFrontmatter<T>>
}

export type ListCardsOptions = {
  column?: string
}

export type SearchCardsOptions = {
  query: string
  columns?: string[]
  tags?: string[]
  limit?: number
}

export type StorageKind = "filesystem" | "memory"

export type KanbamdOptions = {
  root?: string
  columns: string[]
  createRoot?: boolean
  createColumns?: boolean
  storage?: StorageKind
}
