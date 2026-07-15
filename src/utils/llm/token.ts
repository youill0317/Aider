export async function tokenCount(text: string): Promise<number> {
  // This threshold only chooses direct context versus RAG. Two UTF-8 bytes per
  // token intentionally overestimates typical text without bundling tokenizer
  // rank tables into the plugin.
  return Math.ceil(new TextEncoder().encode(text).byteLength / 2)
}
