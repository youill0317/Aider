import {
  createVoyageContextualMetadata,
  getVectorLineRange,
  hasExactLineMetadata,
} from './vector-metadata'

describe('vector metadata helpers', () => {
  it('treats legacy startLine/endLine metadata as exact line metadata', () => {
    const metadata = {
      startLine: 12,
      endLine: 18,
    }

    expect(hasExactLineMetadata(metadata)).toBe(true)
    expect(getVectorLineRange(metadata)).toEqual({
      startLine: 12,
      endLine: 18,
    })
  })

  it('treats Voyage contextual metadata as file-only metadata', () => {
    const metadata = createVoyageContextualMetadata({
      chunkerVersion: 'ctx-v1',
      embeddingProfile: 'voyage-profile',
    })

    expect(metadata).toMatchObject({
      linkMode: 'file-only',
      source: 'voyage-auto-chunk',
      chunkerVersion: 'ctx-v1',
      chunkSizeMode: 'server-default',
    })
    expect(metadata).not.toHaveProperty('startLine')
    expect(metadata).not.toHaveProperty('endLine')
    expect(hasExactLineMetadata(metadata)).toBe(false)
    expect(getVectorLineRange(metadata)).toBeNull()
  })
})
