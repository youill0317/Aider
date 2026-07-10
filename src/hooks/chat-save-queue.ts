import { ChatMessage } from '../types/chat'

export class ChatSaveQueue {
  private pending = new Map<string, ChatMessage[]>()
  private blockedByDelete = new Map<string, ChatMessage[]>()
  private deleted = new Set<string>()
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private persist: (id: string, messages: ChatMessage[]) => Promise<void>,
    private onError: (error: unknown) => void,
  ) {}

  schedule(id: string, messages: ChatMessage[]): void {
    if (this.deleted.has(id)) {
      this.blockedByDelete.set(id, messages)
      return
    }
    this.pending.set(id, messages)
  }

  drain(): void {
    const pending = [...this.pending]
    this.pending.clear()
    if (pending.length === 0) return

    this.queue = this.queue.then(async () => {
      for (const [id, messages] of pending) {
        try {
          await this.persist(id, messages)
        } catch (error) {
          this.onError(error)
        }
      }
    })
  }

  async flush(): Promise<void> {
    let stable = false
    while (!stable) {
      this.drain()
      const queueTail = this.queue
      await queueTail
      await Promise.resolve()
      stable = this.pending.size === 0 && queueTail === this.queue
    }
  }

  async delete(id: string, remove: () => Promise<void>): Promise<void> {
    const pendingBeforeDelete = this.pending.get(id)
    this.deleted.add(id)
    this.pending.delete(id)
    this.blockedByDelete.delete(id)
    try {
      await this.flush()
      await remove()
      this.blockedByDelete.delete(id)
    } catch (error) {
      this.deleted.delete(id)
      const latestMessages = this.blockedByDelete.get(id) ?? pendingBeforeDelete
      this.blockedByDelete.delete(id)
      if (latestMessages) {
        this.pending.set(id, latestMessages)
        await this.flush()
      }
      throw error
    }
  }

  async mutate<T>(mutation: () => Promise<T>): Promise<T> {
    await this.flush()
    const result = this.queue.then(mutation)
    this.queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
