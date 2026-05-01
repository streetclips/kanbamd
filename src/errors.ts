export class KanbamdError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class BoardRootNotFoundError extends KanbamdError {}

export class ColumnNotFoundError extends KanbamdError {}

export class CardNotFoundError extends KanbamdError {}

export class DuplicateCardError extends KanbamdError {}

export class InvalidFrontmatterError extends KanbamdError {}

export class InvalidStorageConfigurationError extends KanbamdError {}
