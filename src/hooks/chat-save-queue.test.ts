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
  await queue.flush()

  expect(events).toEqual(['save:deleted', 'delete:deleted'])
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

function fail(error: unknown): never {
  throw error
}
