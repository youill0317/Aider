class DatabaseException extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseException'
  }
}

export class DatabaseNotInitializedException extends DatabaseException {
  constructor(message = 'Database not initialized') {
    super(message)
    this.name = 'DatabaseNotInitializedException'
  }
}

export class PGLiteAbortedException extends DatabaseException {
  constructor(message = 'PGLite aborted during runtime') {
    super(message)
    this.name = 'PGLiteAbortedException'
  }
}
