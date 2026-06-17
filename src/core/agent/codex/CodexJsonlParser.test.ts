import { CodexJsonlParseError, CodexJsonlParser } from './CodexJsonlParser'

describe('CodexJsonlParser', () => {
  it('emits typed events when chunks contain complete and split JSONL lines', () => {
    // Given: Codex JSONL output split across arbitrary process chunks.
    const parser = new CodexJsonlParser()

    // When: chunks are parsed incrementally.
    const firstEvents = parser.push(
      '{"type":"thread.started","thread_id":"thread-1"}\n{"type":"turn.started","turn_id":"',
    )
    const secondEvents = parser.push(
      'turn-1"}\n{"type":"item.completed","item":{"id":"item-1","type":"message","text":"Done"}}\n',
    )

    // Then: only complete lines are emitted as typed parser events.
    expect(firstEvents).toEqual([
      {
        kind: 'thread.started',
        line: 1,
        threadId: 'thread-1',
      },
    ])
    expect(secondEvents).toEqual([
      {
        kind: 'turn.started',
        line: 2,
        turnId: 'turn-1',
      },
      {
        item: {
          id: 'item-1',
          text: 'Done',
          type: 'message',
        },
        kind: 'item.completed',
        line: 3,
      },
    ])
  })

  it('reports malformed JSON with the source line number', () => {
    // Given: one valid JSONL event followed by malformed JSON.
    const parser = new CodexJsonlParser()

    // When/Then: parsing fails with the malformed source line.
    expect(() =>
      parser.push('{"type":"turn.completed","turn_id":"turn-1"}\n{"type":'),
    ).not.toThrow()

    let thrown: unknown
    try {
      parser.flush()
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(CodexJsonlParseError)
    if (thrown instanceof CodexJsonlParseError) {
      expect(thrown.message).toContain('line 2')
    } else {
      fail('expected CodexJsonlParseError')
    }
  })

  it('maps Codex error lines into typed error events', () => {
    // Given: a Codex error JSONL event.
    const parser = new CodexJsonlParser()

    // When: the line is parsed.
    const events = parser.push(
      '{"type":"error","message":"model unavailable","code":"rate_limited"}\n',
    )

    // Then: the parser emits a typed error event instead of throwing.
    expect(events).toEqual([
      {
        code: 'rate_limited',
        kind: 'error',
        line: 1,
        message: 'model unavailable',
      },
    ])
  })

  it('accepts real Codex turn events without turn ids', () => {
    // Given: Codex 0.139 emits turn lifecycle events without turn_id.
    const parser = new CodexJsonlParser()

    // When: the lines are parsed.
    const events = parser.push(
      '{"type":"turn.started"}\n{"type":"turn.completed"}\n',
    )

    // Then: lifecycle events still reach the UI instead of failing the run.
    expect(events).toEqual([
      {
        kind: 'turn.started',
        line: 1,
      },
      {
        kind: 'turn.completed',
        line: 2,
      },
    ])
  })

  it('preserves unknown event payloads without throwing', () => {
    // Given: Codex emits a future event type this plugin does not recognize yet.
    const parser = new CodexJsonlParser()

    // When: the line is parsed.
    const events = parser.push(
      '{"type":"future.event","value":{"nested":true},"sequence":4}\n',
    )

    // Then: the raw payload is preserved for diagnostics and future UI support.
    expect(events).toEqual([
      {
        kind: 'unknown',
        line: 1,
        payload: {
          sequence: 4,
          type: 'future.event',
          value: {
            nested: true,
          },
        },
        type: 'future.event',
      },
    ])
  })
})
