import {
  AdvancedLinesDiffComputer,
  ILinesDiffComputerOptions,
  LineRangeMapping,
} from 'vscode-diff'

export type DiffBlock =
  | {
      type: 'unchanged'
      value: string
    }
  | {
      type: 'modified'
      originalValue?: string
      modifiedValue?: string
    }

export function combineDiffValues(
  originalValue?: string,
  modifiedValue?: string,
): string {
  if (!originalValue) return modifiedValue ?? ''
  if (!modifiedValue) return originalValue
  const separator =
    /[\r\n]$/.test(originalValue) || /^[\r\n]/.test(modifiedValue) ? '' : '\n'
  return `${originalValue}${separator}${modifiedValue}`
}

export function createDiffBlocks(
  currentMarkdown: string,
  incomingMarkdown: string,
): DiffBlock[] {
  const blocks: DiffBlock[] = []

  const advOptions: ILinesDiffComputerOptions = {
    ignoreTrimWhitespace: false,
    computeMoves: true,
    // Bound Apply view startup; a single full-file block is the safe fallback
    // when a granular diff exceeds the interaction budget.
    maxComputationTimeMs: 100,
  }
  const advDiffComputer = new AdvancedLinesDiffComputer()

  const currentLines = splitLinesPreservingEndings(currentMarkdown)
  const incomingLines = splitLinesPreservingEndings(incomingMarkdown)
  const diffResult = advDiffComputer.computeDiff(
    currentLines,
    incomingLines,
    advOptions,
  )
  if (diffResult.hitTimeout) {
    return [
      {
        type: 'modified',
        originalValue: currentMarkdown || undefined,
        modifiedValue: incomingMarkdown || undefined,
      },
    ]
  }
  const advLineChanges = diffResult.changes

  let lastOriginalEndLineNumberExclusive = 1 // 1-indexed
  advLineChanges.forEach((change: LineRangeMapping) => {
    const oStart = change.originalRange.startLineNumber
    const oEnd = change.originalRange.endLineNumberExclusive
    const mStart = change.modifiedRange.startLineNumber
    const mEnd = change.modifiedRange.endLineNumberExclusive

    // Emit unchanged blocks
    if (oStart > lastOriginalEndLineNumberExclusive) {
      const unchangedValue = currentLines
        .slice(lastOriginalEndLineNumberExclusive - 1, oStart - 1)
        .join('')
      if (unchangedValue.length > 0) {
        blocks.push({
          type: 'unchanged',
          value: unchangedValue,
        })
      }
    }

    // Emit modified blocks
    const originalValue = currentLines.slice(oStart - 1, oEnd - 1).join('')
    const modifiedValue = incomingLines.slice(mStart - 1, mEnd - 1).join('')
    if (originalValue.length > 0 || modifiedValue.length > 0) {
      blocks.push({
        type: 'modified',
        originalValue: originalValue.length > 0 ? originalValue : undefined,
        modifiedValue: modifiedValue.length > 0 ? modifiedValue : undefined,
      })
    }

    lastOriginalEndLineNumberExclusive = oEnd
  })

  // Emit final unchanged blocks (if any)
  if (currentLines.length > lastOriginalEndLineNumberExclusive - 1) {
    const unchangedValue = currentLines
      .slice(lastOriginalEndLineNumberExclusive - 1)
      .join('')
    if (unchangedValue.length > 0) {
      blocks.push({
        type: 'unchanged',
        value: unchangedValue,
      })
    }
  }

  return blocks
}

function splitLinesPreservingEndings(value: string): string[] {
  return value.match(/[^\r\n]*(?:\r\n|\n|\r)|[^\r\n]+/g) ?? ['']
}
