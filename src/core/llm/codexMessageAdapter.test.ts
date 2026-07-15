import { CodexMessageAdapter } from './codexMessageAdapter'

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
})
