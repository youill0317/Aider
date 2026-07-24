import { ChatMessage } from '../types/chat'

export class ChatSaveQueue {
  private static readonly MAX_DELETED_TOMBSTONES = 1_000
  private pending = new Map<string, ChatMessage[]>()
  private latest = new Map<string, ChatMessage[]>()
  private deleteRecovery = new Map<string, ChatMessage[]>()
  private deleting = new Set<string>()
  private deleted = new Set<string>()
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private persist: (id: string, messages: ChatMessage[]) => Promise<void>,
    private onError: (error: unknown) => void,
  ) {}

  schedule(id: string, messages: ChatMessage[]): void {
    if (this.deleted.has(id)) {
      return
    }
    if (this.deleting.has(id)) {
      this.deleteRecovery.set(id, messages)
      this.latest.set(id, messages)
      return
    }
    this.pending.set(id, messages)
    this.latest.set(id, messages)
  }

  peek(id: string): ChatMessage[] | undefined {
    return this.latest.get(id)
  }

  drain(): void {
    const pending = [...this.pending]
    this.pending.clear()
    if (pending.length === 0) return

    const persistPending = async () => {
      for (let index = 0; index < pending.length; index += 1) {
        const [id, messages] = pending[index]
        try {
          await this.persist(id, messages)
          if (this.latest.get(id) === messages) {
            this.latest.delete(id)
          }
        } catch (error) {
          for (
            let retryIndex = index;
            retryIndex < pending.length;
            retryIndex += 1
          ) {
            const [retryId, retryMessages] = pending[retryIndex]
            const retryQueue = this.deleting.has(retryId)
              ? this.deleteRecovery
              : this.pending
            if (!retryQueue.has(retryId)) {
              retryQueue.set(retryId, retryMessages)
            }
          }
          this.onError(error)
          throw error
        }
      }
    }
    this.queue = this.queue.then(persistPending, persistPending)
    void this.queue.catch(() => undefined)
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
    this.deleting.add(id)
    this.pending.delete(id)
    this.deleteRecovery.delete(id)
    try {
      await this.flush()
      await remove()
      this.deleteRecovery.delete(id)
      this.latest.delete(id)
      this.rememberDeleted(id)
    } catch (error) {
      this.deleting.delete(id)
      const latestMessages = this.deleteRecovery.get(id) ?? pendingBeforeDelete
      this.deleteRecovery.delete(id)
      if (latestMessages) {
        this.pending.set(id, latestMessages)
        await this.flush()
      }
      throw error
    } finally {
      this.deleting.delete(id)
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

  private rememberDeleted(id: string): void {
    this.deleted.delete(id)
    this.deleted.add(id)
    if (this.deleted.size <= ChatSaveQueue.MAX_DELETED_TOMBSTONES) return
    const oldest = this.deleted.values().next()
    if (!oldest.done) this.deleted.delete(oldest.value)
  }
}
