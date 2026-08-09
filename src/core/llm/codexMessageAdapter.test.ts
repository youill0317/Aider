import { CodexMessageAdapter } from './codexMessageAdapter'

function createAdapter(events: unknown[]): CodexMessageAdapter {
  const fetchFn = jest
    .fn()
    .mockResolvedValue(
      new Response(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
        { status: 200 },
      ),
    ) as unknown as typeof fetch
  return new CodexMessageAdapter({ fetchFn })
}

async function collectContent(
  stream: AsyncIterable<{
    choices: { delta: { content?: string | null } }[]
  }>,
): Promise<string> {
  let content = ''
  for await (const chunk of stream) {
    content += chunk.choices[0]?.delta.content ?? ''
  }
  return content
}

describe('CodexMessageAdapter', () => {
  it('does not emit a full reasoning summary after its deltas', async () => {
    const events = [
      {
        type: 'response.created',
        response: {
          id: 'response-id',
          created_at: 1,
          model: 'codex-model',
          output: [],
        },
      },
      {
        type: 'response.reasoning_summary_text.delta',
        item_id: 'reasoning-id',
        output_index: 0,
        summary_index: 0,
        sequence_number: 1,
        delta: 'First ',
      },
      {
        type: 'response.reasoning_summary_text.delta',
        item_id: 'reasoning-id',
        output_index: 0,
        summary_index: 0,
        sequence_number: 2,
        delta: 'summary',
      },
      {
        type: 'response.reasoning_summary_text.done',
        item_id: 'reasoning-id',
        output_index: 0,
        summary_index: 0,
        sequence_number: 3,
        text: 'First summary',
      },
      {
        type: 'response.reasoning_summary_text.done',
        item_id: 'reasoning-id',
        output_index: 0,
        summary_index: 1,
        sequence_number: 4,
        text: 'Fallback summary',
      },
    ]
    const fetchFn = jest
      .fn()
      .mockResolvedValue(
        new Response(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
          { status: 200 },
        ),
      ) as unknown as typeof fetch
    const adapter = new CodexMessageAdapter({ fetchFn })
    const stream = await adapter.streamResponse({
      model: 'codex-model',
      messages: [],
      stream: true,
    })
    const reasoning: (string | null | undefined)[] = []

    for await (const chunk of stream) {
      reasoning.push(chunk.choices[0]?.delta.reasoning)
    }

    expect(reasoning.filter(Boolean)).toEqual([
      'First ',
      'summary',
      'Fallback summary',
    ])
  })

  it('rejects failed responses in snapshot and streaming paths', async () => {
    const events = [
      {
        type: 'response.created',
        response: {
          id: 'response-id',
          created_at: 1,
          model: 'codex-model',
          output: [],
        },
      },
      {
        type: 'response.failed',
        response: {
          id: 'response-id',
          created_at: 1,
          model: 'codex-model',
          output: [],
          error: { code: 'server_error', message: 'Provider failed' },
        },
      },
    ]

    await expect(
      createAdapter(events).generateResponse({
        model: 'codex-model',
        messages: [],
        stream: false,
      }),
    ).rejects.toThrow('Provider failed')
    const stream = await createAdapter(events).streamResponse({
      model: 'codex-model',
      messages: [],
      stream: true,
    })
    await expect(collectContent(stream)).rejects.toThrow('Provider failed')
  })

  it('returns refusal deltas and done-only refusal text', async () => {
    const events = [
      {
        type: 'response.created',
        response: {
          id: 'response-id',
          created_at: 1,
          model: 'codex-model',
          output: [],
          output_text: '',
        },
      },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          id: 'message-id',
          content: [],
          role: 'assistant',
          status: 'in_progress',
          type: 'message',
        },
      },
      {
        type: 'response.content_part.added',
        output_index: 0,
        content_index: 0,
        part: { refusal: '', type: 'refusal' },
      },
      {
        type: 'response.refusal.delta',
        item_id: 'message-id',
        output_index: 0,
        content_index: 0,
        delta: "I can't ",
      },
      {
        type: 'response.refusal.done',
        item_id: 'message-id',
        output_index: 0,
        content_index: 0,
        refusal: "I can't ",
      },
      {
        type: 'response.content_part.added',
        output_index: 0,
        content_index: 1,
        part: { refusal: '', type: 'refusal' },
      },
      {
        type: 'response.refusal.done',
        item_id: 'message-id',
        output_index: 0,
        content_index: 1,
        refusal: 'help',
      },
    ]

    await expect(
      createAdapter(events).generateResponse({
        model: 'codex-model',
        messages: [],
        stream: false,
      }),
    ).resolves.toMatchObject({
      choices: [{ message: { content: "I can't help" } }],
    })
    const stream = await createAdapter(events).streamResponse({
      model: 'codex-model',
      messages: [],
      stream: true,
    })
    await expect(collectContent(stream)).resolves.toBe("I can't help")
  })
})
