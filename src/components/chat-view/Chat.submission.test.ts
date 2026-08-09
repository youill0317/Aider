jest.mock('obsidian', () => ({ Notice: jest.fn() }))
jest.mock('../modals/ConfirmModal', () => ({ ConfirmModal: class {} }))
jest.mock('../modals/ErrorModal', () => ({ ErrorModal: class {} }))
jest.mock('../modals/TemplateSectionModal', () => ({
  TemplateSectionModal: class {},
}))
jest.mock('../../utils/chat/promptGenerator', () => ({
  PromptGenerator: class {},
}))
jest.mock('./AssistantToolMessageGroupItem', () => () => null)
jest.mock('./chat-input/ChatUserInput', () => () => null)
jest.mock('./ChatListDropdown', () => ({ ChatListDropdown: () => null }))
jest.mock('./QueryProgress', () => () => null)
jest.mock('./ToolMessage', () => () => null)
jest.mock('./UserMessageItem', () => () => null)

import { ChatUserMessage } from '../../types/chat'

import {
  createHistoricalEditSubmitter,
  createSubmittedDraftRestorer,
} from './Chat'

function draft(id: string): ChatUserMessage {
  return {
    role: 'user',
    content: null,
    promptContent: null,
    id,
    mentionables: [],
  }
}

describe('chat submission controllers', () => {
  it('restores a failed submission only while its replacement is untouched', () => {
    const submittedDraft = draft('submitted')
    const replacementDraft = draft('replacement')
    const restore = createSubmittedDraftRestorer(
      submittedDraft,
      replacementDraft,
    )
    const editedReplacement = { ...replacementDraft }

    expect(restore(replacementDraft)).toBe(submittedDraft)
    expect(restore(editedReplacement)).toBe(editedReplacement)
    expect(restore(draft('newer')).id).toBe('newer')
  })

  it('submits the latest message without confirmation', async () => {
    const submit = jest.fn().mockResolvedValue(true)
    const confirm = jest.fn()

    await expect(
      createHistoricalEditSubmitter(false, submit, confirm)(),
    ).resolves.toBe(true)

    expect(submit).toHaveBeenCalledTimes(1)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('requires confirmation before truncating later messages', async () => {
    const submit = jest.fn().mockResolvedValue(true)
    let confirmEdit = () => {}
    const confirm = jest.fn((onConfirm: () => void) => {
      confirmEdit = onConfirm
    })
    const result = createHistoricalEditSubmitter(true, submit, confirm)()

    expect(submit).not.toHaveBeenCalled()
    confirmEdit()

    await expect(result).resolves.toBe(true)
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('leaves history unchanged when confirmation is cancelled', async () => {
    const submit = jest.fn().mockResolvedValue(true)
    let cancelEdit = () => {}
    const confirm = jest.fn(
      (_onConfirm: () => void, onCancel: () => void) => {
        cancelEdit = onCancel
      },
    )
    const result = createHistoricalEditSubmitter(true, submit, confirm)()

    cancelEdit()

    await expect(result).resolves.toBe(false)
    expect(submit).not.toHaveBeenCalled()
  })
})
