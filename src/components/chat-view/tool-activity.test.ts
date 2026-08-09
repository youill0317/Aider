import { ToolCallResponseStatus } from '../../types/tool-call.types'

import {
  getFirstSelectedStepId,
  getToolActivityHeader,
  getToolActivitySteps,
  shouldOpenActivityTimeline,
  shouldUseActivityTimeline,
} from './tool-activity'

describe('tool activity summaries', () => {
  it('summarizes completed tool calls into a compact header', () => {
    const steps = getToolActivitySteps([
      {
        id: 'message-1',
        role: 'tool',
        toolCalls: [
          {
            request: {
              id: 'tool-1',
              name: 'github__search',
              arguments: JSON.stringify({ query: 'smart composer' }),
            },
            response: {
              status: ToolCallResponseStatus.Success,
              data: { type: 'text', text: 'ok' },
            },
          },
          {
            request: {
              id: 'tool-2',
              name: 'read_file',
              arguments: JSON.stringify({ path: 'notes/today.md' }),
            },
            response: {
              status: ToolCallResponseStatus.Success,
              data: { type: 'text', text: 'ok' },
            },
          },
        ],
      },
    ])

    expect(shouldUseActivityTimeline(steps)).toBe(true)
    expect(shouldOpenActivityTimeline(steps)).toBe(false)
    expect(getToolActivityHeader(steps)).toBe(
      'Used 2 tools: github:search, read_file',
    )
    expect(steps[0]?.summary).toBe('query: smart composer')
  })

  it('keeps active tool calls in the original actionable UI', () => {
    const steps = getToolActivitySteps([
      {
        id: 'message-1',
        role: 'tool',
        toolCalls: [
          {
            request: {
              id: 'tool-1',
              name: 'github__search',
            },
            response: {
              status: ToolCallResponseStatus.PendingApproval,
            },
          },
        ],
      },
    ])

    expect(shouldUseActivityTimeline(steps)).toBe(false)
  })

  it('bounds summaries of deeply nested tool arguments', () => {
    const argumentsText = `${'{"nested":'.repeat(5_000)}true${'}'.repeat(5_000)}`

    const steps = getToolActivitySteps([
      {
        id: 'message-1',
        role: 'tool',
        toolCalls: [
          {
            request: {
              id: 'tool-1',
              name: 'write_file',
              arguments: argumentsText,
            },
            response: {
              status: ToolCallResponseStatus.PendingApproval,
            },
          },
        ],
      },
    ])

    expect(steps[0]?.summary).toBe('nested: nested: nested: ...')
  })

  it('opens failed completed activity and selects the failing step', () => {
    const steps = getToolActivitySteps([
      {
        id: 'message-1',
        role: 'tool',
        toolCalls: [
          {
            request: {
              id: 'tool-1',
              name: 'read_file',
            },
            response: {
              status: ToolCallResponseStatus.Success,
              data: { type: 'text', text: 'ok' },
            },
          },
          {
            request: {
              id: 'tool-2',
              name: 'write_file',
            },
            response: {
              status: ToolCallResponseStatus.Error,
              error: 'Permission denied',
            },
          },
        ],
      },
    ])

    expect(shouldOpenActivityTimeline(steps)).toBe(true)
    expect(getFirstSelectedStepId(steps)).toBe('message-1:tool-2')
  })
})
