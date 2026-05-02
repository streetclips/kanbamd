import matter from "gray-matter"
import slugify from "slugify"
import { CardNotFoundError, InvalidFrontmatterError } from "./errors.js"
import type { BaseFrontmatter, CardFrontmatter, ExtraFrontmatter } from "./types.js"

const reservedFrontmatterKeys = new Set(["title", "tags", "order"])

export function toFileName(id: string): string {
  return `${id.replace(/\.md$/, "")}.md`
}

export function toId(fileName: string): string {
  return fileName.replace(/\.md$/, "")
}

export function createSlug(title: string): string {
  const slug = slugify(title, {
    lower: true,
    strict: true,
    trim: true,
  })
  return slug || "card"
}

export function validateColumnName(column: string): void {
  if (
    !column ||
    column.includes("/") ||
    column.includes("\\") ||
    column === "." ||
    column === ".."
  ) {
    throw new InvalidFrontmatterError(`Invalid column name: ${column}`)
  }
}

export function validateCardId(id: string): void {
  if (
    !id ||
    id.includes("/") ||
    id.includes("\\") ||
    id === "." ||
    id === ".." ||
    id.endsWith(".md")
  ) {
    throw new CardNotFoundError(`Invalid card id: ${id}`)
  }
}

export function validateTitle(title: string): void {
  if (typeof title !== "string" || title.trim() === "") {
    throw new InvalidFrontmatterError("Card title must be a non-empty string.")
  }
}

export function validateTags(tags: string[]): void {
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
    throw new InvalidFrontmatterError("Card tags must be a string array.")
  }
}

export function validateExtraFrontmatter(frontmatter: ExtraFrontmatter | undefined): void {
  if (!frontmatter) {
    return
  }

  for (const key of Object.keys(frontmatter)) {
    if (reservedFrontmatterKeys.has(key)) {
      throw new InvalidFrontmatterError(`Frontmatter key is reserved: ${key}`)
    }
  }
}

export function parseCardFrontmatter<T extends ExtraFrontmatter>(
  content: string,
  fileName: string,
): { frontmatter: CardFrontmatter<T>; body: string } {
  const parsed = matter(content)
  assertBaseFrontmatter(parsed.data, fileName)

  return {
    frontmatter: parsed.data as unknown as CardFrontmatter<T>,
    body: parsed.content.replace(/^\n/, ""),
  }
}

export function stringifyCard<T extends ExtraFrontmatter>(
  frontmatter: CardFrontmatter<T>,
  body: string,
): string {
  return matter.stringify(body ?? "", frontmatter)
}

export function assertBaseFrontmatter(
  data: Record<string, unknown>,
  fileName: string,
): asserts data is BaseFrontmatter {
  if (typeof data.title !== "string" || data.title.trim() === "") {
    throw new InvalidFrontmatterError(`Card ${fileName} must have a non-empty string title.`)
  }

  if (!Array.isArray(data.tags) || data.tags.some((tag) => typeof tag !== "string")) {
    throw new InvalidFrontmatterError(`Card ${fileName} must have a tags string array.`)
  }

  if (typeof data.order !== "number" || !Number.isInteger(data.order) || data.order < 1) {
    throw new InvalidFrontmatterError(`Card ${fileName} must have a positive integer order.`)
  }
}
