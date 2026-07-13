import { tokenCount } from './token'

describe('tokenCount', () => {
  it.each([
    ['', 0],
    ['abcd', 2],
    ['안', 2],
    ['👋', 2],
  ])('estimates from UTF-8 bytes for %p', async (text, expected) => {
    await expect(tokenCount(text)).resolves.toBe(expected)
  })
})
