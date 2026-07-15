export type MarkdownChunk = {
  readonly content: string
  readonly startLine: number
  readonly endLine: number
}

type TextChunk = {
  readonly content: string
  readonly start: number
}

const CHUNK_OVERLAP = 200
const MARKDOWN_SEPARATORS = [
  '\n## ',
  '\n### ',
  '\n#### ',
  '\n##### ',
  '\n###### ',
  '```\n\n',
  '\n\n***\n\n',
  '\n\n---\n\n',
  '\n\n___\n\n',
  '\n\n',
  '\n',
  ' ',
  '',
] as const

export function splitMarkdown(
  text: string,
  chunkSize: number,
): MarkdownChunk[] {
  if (chunkSize <= CHUNK_OVERLAP) {
    throw new Error('Markdown chunk size must be greater than 200')
  }

  const chunks = splitText(text, MARKDOWN_SEPARATORS, chunkSize)
  const documents: MarkdownChunk[] = []
  let line = 1
  let offset = 0

  for (const chunk of chunks) {
    line += countNewlines(text.slice(offset, chunk.start))

    const newlines = countNewlines(chunk.content)
    documents.push({
      content: chunk.content,
      startLine: line,
      endLine: line + newlines,
    })
    offset = chunk.start
  }

  return documents
}

function splitText(
  text: string,
  separators: readonly string[],
  chunkSize: number,
  start = 0,
): TextChunk[] {
  let separator = separators.at(-1) ?? ''
  let remainingSeparators: readonly string[] | undefined

  for (let index = 0; index < separators.length; index += 1) {
    const candidate = separators[index]
    if (candidate === '') {
      separator = candidate
      break
    }
    if (text.includes(candidate)) {
      separator = candidate
      remainingSeparators = separators.slice(index + 1)
      break
    }
  }

  if (separator === '') {
    return splitCharacters(text, chunkSize, start)
  }

  const finalChunks: TextChunk[] = []
  let goodSplits: TextChunk[] = []
  for (const split of splitOnSeparator(text, separator, start)) {
    if (split.content.length < chunkSize) {
      goodSplits.push(split)
      continue
    }
    if (goodSplits.length > 0) {
      finalChunks.push(...mergeSplits(goodSplits, chunkSize))
      goodSplits = []
    }
    finalChunks.push(
      ...(remainingSeparators
        ? splitText(split.content, remainingSeparators, chunkSize, split.start)
        : [split]),
    )
  }
  if (goodSplits.length > 0) {
    finalChunks.push(...mergeSplits(goodSplits, chunkSize))
  }
  return finalChunks
}

function* splitOnSeparator(
  text: string,
  separator: string,
  start: number,
): Iterable<TextChunk> {
  let splitStart = 0
  let separatorIndex = text.indexOf(separator)
  while (separatorIndex !== -1) {
    if (separatorIndex > splitStart) {
      yield {
        content: text.slice(splitStart, separatorIndex),
        start: start + splitStart,
      }
      splitStart = separatorIndex
    }
    separatorIndex = text.indexOf(separator, separatorIndex + 1)
  }
  if (splitStart < text.length) {
    yield { content: text.slice(splitStart), start: start + splitStart }
  }
}

function splitCharacters(
  text: string,
  chunkSize: number,
  start: number,
): TextChunk[] {
  const chunks: TextChunk[] = []
  const windowSize = Math.floor(chunkSize)
  const step = Math.max(1, windowSize - CHUNK_OVERLAP)
  for (let offset = 0; offset < text.length; offset += step) {
    appendRawChunk(
      chunks,
      text.slice(offset, offset + windowSize),
      start + offset,
    )
    if (offset + windowSize >= text.length) break
  }
  return chunks
}

function mergeSplits(
  splits: Iterable<TextChunk>,
  chunkSize: number,
): TextChunk[] {
  const chunks: TextChunk[] = []
  const current: TextChunk[] = []
  let first = 0
  let total = 0

  for (const split of splits) {
    if (total + split.content.length > chunkSize && first < current.length) {
      appendMergedChunk(chunks, current, first)
      while (
        total > CHUNK_OVERLAP ||
        (total + split.content.length > chunkSize && total > 0)
      ) {
        total -= current[first].content.length
        first += 1
      }
      if (first > 1024) {
        current.splice(0, first)
        first = 0
      }
    }
    current.push(split)
    total += split.content.length
  }

  appendMergedChunk(chunks, current, first)
  return chunks
}

function appendMergedChunk(
  chunks: TextChunk[],
  splits: readonly TextChunk[],
  first: number,
): void {
  if (first >= splits.length) return
  const raw = splits
    .slice(first)
    .map((split) => split.content)
    .join('')
  appendRawChunk(chunks, raw, splits[first].start)
}

function appendRawChunk(chunks: TextChunk[], raw: string, start: number): void {
  const content = raw.trim()
  if (!content) return
  chunks.push({
    content,
    start: start + raw.length - raw.trimStart().length,
  })
}

function countNewlines(text: string): number {
  return text.match(/\n/g)?.length ?? 0
}
