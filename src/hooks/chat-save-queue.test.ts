import type { ChatMessage } from '../types/chat'

import { ChatSaveQueue } from './chat-save-queue'

const messages = [
  { role: 'assistant', id: 'answer', content: 'done' },
] as ChatMessage[]

test('drains saves queued while a flush is running', async () => {
  const saved: string[] = []
  const queue = new ChatSaveQueue(async (id) => {
    saved.push(id)
    if (id === 'first') queue.schedule('second', messages)
  }, fail)

  queue.schedule('first', messages)
  await queue.flush()

  expect(saved).toEqual(['first', 'second'])
})

test('retries a failed save on the next flush', async () => {
  const saveError = new Error('disk full')
  const persist = jest
    .fn<Promise<void>, [string, ChatMessage[]]>()
    .mockRejectedValueOnce(saveError)
    .mockResolvedValueOnce(undefined)
  const onError = jest.fn()
  const queue = new ChatSaveQueue(persist, onError)
  queue.schedule('chat', messages)

  await expect(queue.flush()).rejects.toBe(saveError)
  await expect(queue.flush()).resolves.toBeUndefined()

  expect(persist).toHaveBeenCalledTimes(2)
  expect(onError).toHaveBeenCalledWith(saveError)
})

test('retains entries not reached before a save failure', async () => {
  const saveError = new Error('disk full')
  const saved: string[] = []
  let failFirst = true
  const queue = new ChatSaveQueue(async (id) => {
    saved.push(id)
    if (failFirst) {
      failFirst = false
      throw saveError
    }
  }, jest.fn())
  queue.schedule('first', messages)
  queue.schedule('second', messages)

  await expect(queue.flush()).rejects.toBe(saveError)
  await queue.flush()

  expect(saved).toEqual(['first', 'first', 'second'])
})

test('keeps the latest snapshot scheduled while a save fails', async () => {
  const saveError = new Error('disk full')
  const latestMessages = [
    { role: 'assistant', id: 'latest-answer', content: 'latest' },
  ] as ChatMessage[]
  const saved: ChatMessage[][] = []
  let failFirst = true
  const queue = new ChatSaveQueue(async (id, nextMessages) => {
    saved.push(nextMessages)
    if (failFirst) {
      failFirst = false
      queue.schedule(id, latestMessages)
      throw saveError
    }
  }, jest.fn())
  queue.schedule('chat', messages)

  await expect(queue.flush()).rejects.toBe(saveError)
  await queue.flush()

  expect(saved).toEqual([messages, latestMessages])
})

test('exposes the latest snapshot until it is durably saved', async () => {
  let finishFirstSave: (() => void) | undefined
  let saveCount = 0
  const latestMessages = [
    { role: 'assistant', id: 'latest-answer', content: 'latest' },
  ] as ChatMessage[]
  const queue = new ChatSaveQueue(() => {
    saveCount += 1
    return saveCount === 1
      ? new Promise<void>((resolve) => {
          finishFirstSave = resolve
        })
      : Promise.resolve()
  }, fail)

  queue.schedule('chat', messages)
  queue.drain()
  await Promise.resolve()
  expect(finishFirstSave).toBeDefined()
  queue.schedule('chat', latestMessages)

  expect(queue.peek('chat')).toBe(latestMessages)

  finishFirstSave?.()
  await Promise.resolve()
  expect(queue.peek('chat')).toBe(latestMessages)
  await queue.flush()
  expect(queue.peek('chat')).toBeUndefined()
})

test('serializes deletion after pending saves and blocks resurrection', async () => {
  let finishSave: (() => void) | undefined
  const events: string[] = []
  const queue = new ChatSaveQueue(
    (id) =>
      new Promise<void>((resolve) => {
        events.push(`save:${id}`)
        finishSave = resolve
      }),
    fail,
  )
  queue.schedule('deleted', messages)
  queue.drain()

  const deletion = queue.delete('deleted', async () => {
    events.push('delete:deleted')
  })
  queue.schedule('deleted', messages)
  await Promise.resolve()
  finishSave?.()
  await deletion
  queue.schedule('deleted', [
    { role: 'assistant', id: 'after-delete', content: 'drop me' },
  ] as ChatMessage[])
  await queue.flush()

  expect(events).toEqual(['save:deleted', 'delete:deleted'])
  expect(
    (
      queue as unknown as {
        deleteRecovery: Map<string, ChatMessage[]>
      }
    ).deleteRecovery.size,
  ).toBe(0)
})

test('restores the latest blocked save when deletion fails', async () => {
  let rejectDeletion: ((error: Error) => void) | undefined
  let markDeletionStarted: (() => void) | undefined
  const deletionStarted = new Promise<void>((resolve) => {
    markDeletionStarted = resolve
  })
  const saved: ChatMessage[][] = []
  const queue = new ChatSaveQueue(async (_id, nextMessages) => {
    saved.push(nextMessages)
  }, fail)
  const latestMessages = [
    { role: 'assistant', id: 'latest-answer', content: 'latest' },
  ] as ChatMessage[]

  const deletion = queue.delete(
    'chat',
    () =>
      new Promise<void>((_resolve, reject) => {
        markDeletionStarted?.()
        rejectDeletion = reject
      }),
  )
  await deletionStarted
  queue.schedule('chat', latestMessages)
  rejectDeletion?.(new Error('delete failed'))

  await expect(deletion).rejects.toThrow('delete failed')
  await queue.flush()

  expect(saved).toEqual([latestMessages])
})

test('runs metadata mutations after pending message saves', async () => {
  let finishSave: (() => void) | undefined
  const events: string[] = []
  const queue = new ChatSaveQueue(
    () =>
      new Promise<void>((resolve) => {
        events.push('save')
        finishSave = resolve
      }),
    fail,
  )
  queue.schedule('chat', messages)
  queue.drain()

  const mutation = queue.mutate(async () => {
    events.push('title')
  })
  await Promise.resolve()
  finishSave?.()
  await mutation

  expect(events).toEqual(['save', 'title'])
})

test('bounds deleted chat tombstones', async () => {
  const queue = new ChatSaveQueue(jest.fn(), fail)

  for (let index = 0; index < 1_001; index += 1) {
    await queue.delete(`chat-${index}`, async () => undefined)
  }

  expect((queue as unknown as { deleted: Set<string> }).deleted.size).toBe(
    1_000,
  )
})

function fail(error: unknown): never {
  throw error
}
