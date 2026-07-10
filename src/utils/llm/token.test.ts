import { getEncoding } from 'js-tiktoken'
import { Tiktoken } from 'js-tiktoken/lite'
import * as cl100kBaseModule from 'js-tiktoken/ranks/cl100k_base'

import { tokenCount } from './token'

const corpus = [
  '',
  'Hello, world!',
  '안녕하세요, 옵시디언!',
  '👋🌍✨',
  'const answer = (value: number) => value * 2\n',
]
const fullEncoder = getEncoding('cl100k_base')
const liteEncoder = new Tiktoken(cl100kBaseModule.default ?? cl100kBaseModule)

describe('tokenCount', () => {
  it.each([
    ['', 0],
    ['Hello, world!', 4],
    ['안녕하세요, 옵시디언!', 13],
    ['👋🌍✨', 8],
    ['const answer = (value: number) => value * 2\n', 14],
  ])('matches cl100k_base for %p', async (text, expected) => {
    await expect(tokenCount(text)).resolves.toBe(expected)
  })

  it.each(corpus)('keeps the exact full-registry token ids for %p', (text) => {
    expect(liteEncoder.encode(text)).toEqual(fullEncoder.encode(text))
  })
})
