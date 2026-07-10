declare module 'js-tiktoken/ranks/cl100k_base' {
  const bpe_ranks: string
  const pat_str: string
  const special_tokens: Record<string, number>
  const ranks: {
    bpe_ranks: string
    pat_str: string
    special_tokens: typeof special_tokens
  }

  export { bpe_ranks, pat_str, special_tokens }
  export default ranks
}
