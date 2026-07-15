import { createHash } from 'crypto'

import { splitMarkdown } from './markdown-text-splitter'

describe('splitMarkdown compatibility', () => {
  it.each([
    [201, '6f67098d3aa5d18426009f4a124f89a6fa5899b1fd3337a2722dd73649f491f7'],
    [240, '96581f78ce7ffca755c19c18ccbc00988557b35c0eb09b98d161e7b7c5bd27ba'],
    [1000, '2b8f1ceb8a07a20f84baf655436be4b62756235a85dddd10ac4c8e76751e9e91'],
  ])(
    'preserves the previous splitter output at chunk size %i',
    (chunkSize, expectedDigest) => {
      const corpus = [
        '# Title\r\n\r\nIntro with 한국어 and emoji 🔥.\r\n',
        '## Section\n' + 'alpha beta gamma '.repeat(45),
        '\n```ts\nconst value = 1\n```\n\n---\n\n',
        'Repeated line\nRepeated line\nRepeated line\n',
        '### Tail\n' + 'z'.repeat(250),
      ].join('')
      const digest = createHash('sha256')
        .update(JSON.stringify(splitMarkdown(corpus, chunkSize)))
        .digest('hex')

      expect(digest).toBe(expectedDigest)
    },
  )

  it('rejects a chunk size that cannot exceed the overlap', () => {
    expect(() => splitMarkdown('text', 200)).toThrow('greater than 200')
  })

  it('tracks source lines when overlapping chunks have identical content', () => {
    const chunks = splitMarkdown('same line\n'.repeat(80), 240)

    expect(chunks[0].content).toBe(chunks[1].content)
    expect(chunks.slice(0, 3).map(({ startLine }) => startLine)).toEqual([
      1, 5, 9,
    ])
    expect(chunks[1].endLine).toBe(28)
  })

  it('avoids character arrays and queue shifts for unbroken text', () => {
    const splitSpy = jest.spyOn(String.prototype, 'split')
    const shiftSpy = jest.spyOn(Array.prototype, 'shift')
    let chunks: ReturnType<typeof splitMarkdown> = []
    let usedCharacterSplit = false
    let shiftCalls = 0

    try {
      splitSpy.mockClear()
      shiftSpy.mockClear()
      chunks = splitMarkdown('x'.repeat(20_000), 1_000)
      usedCharacterSplit = (splitSpy.mock.calls as unknown[][]).some(
        ([separator]) => separator === '',
      )
      shiftCalls = shiftSpy.mock.calls.length
    } finally {
      shiftSpy.mockRestore()
      splitSpy.mockRestore()
    }

    expect(usedCharacterSplit).toBe(false)
    expect(shiftCalls).toBe(0)
    expect(chunks[0].content).toHaveLength(1_000)
  })
})
