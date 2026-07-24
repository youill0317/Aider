import { DiffBlock, combineDiffValues, createDiffBlocks } from './diff'

function reconstruct(
  blocks: DiffBlock[],
  side: 'originalValue' | 'modifiedValue',
): string {
  return blocks
    .map((block) => (block.type === 'unchanged' ? block.value : block[side]))
    .join('')
}

describe('createDiffBlocks', () => {
  test.each([
    ['a\n', 'b\n'],
    ['a', '\na'],
    ['a\nb', 'a\n\nb'],
    ['a', 'a\n'],
    ['a\n', 'a'],
    ['', '\n'],
    ['first\r\nsecond\r\n', 'first\r\nchanged\r\n'],
  ])('preserves exact content for %j -> %j', (current, incoming) => {
    const blocks = createDiffBlocks(current, incoming)

    expect(reconstruct(blocks, 'originalValue')).toBe(current)
    expect(reconstruct(blocks, 'modifiedValue')).toBe(incoming)
  })

  it('reconstructs every pair in a whitespace-heavy corpus', () => {
    const corpus = [
      '',
      '\n',
      '\n\n',
      'a',
      'a\n',
      '\na',
      'a\n\nb',
      'a\r\nb\r\n',
      ' ',
      'a\n \nb',
    ]

    for (const current of corpus) {
      for (const incoming of corpus) {
        const blocks = createDiffBlocks(current, incoming)
        expect(reconstruct(blocks, 'originalValue')).toBe(current)
        expect(reconstruct(blocks, 'modifiedValue')).toBe(incoming)
      }
    }
  })
})

describe('combineDiffValues', () => {
  it('separates two final lines without adding duplicate line breaks', () => {
    expect(combineDiffValues('original', 'suggestion')).toBe(
      'original\nsuggestion',
    )
    expect(combineDiffValues('original\n', 'suggestion\n')).toBe(
      'original\nsuggestion\n',
    )
    expect(combineDiffValues(undefined, '\nsuggestion')).toBe('\nsuggestion')
  })
})
