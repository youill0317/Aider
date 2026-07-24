import { App, TFile, htmlToMarkdown } from 'obsidian'

import { editorStateToPlainText } from '../../components/chat-view/chat-input/utils/editor-state-to-plain-text'
import { QueryProgressState } from '../../components/chat-view/QueryProgress'
import { RAGEngine } from '../../core/rag/ragEngine'
import { SelectEmbedding } from '../../database/schema'
import { getVectorLineRange } from '../../database/vector-metadata'
import { SmartComposerSettings } from '../../settings/schema/setting.types'
import {
  ChatAgentCommandMessage,
  ChatAssistantMessage,
  ChatMessage,
  ChatToolMessage,
  ChatUserMessage,
} from '../../types/chat'
import { ContentPart, RequestMessage } from '../../types/llm/request'
import {
  MentionableBlock,
  MentionableFile,
  MentionableFolder,
  MentionableImage,
  MentionableUrl,
  MentionableVault,
} from '../../types/mentionable'
import { PromptLevel } from '../../types/prompt-level.types'
import { ToolCallResponseStatus } from '../../types/tool-call.types'
import { fetchPublicUrl, isPublicHttpUrl } from '../fetch-utils'
import { tokenCount } from '../llm/token'
import { getNestedFiles, readTFileContent } from '../obsidian'
import { redactSecrets } from '../security/redact-secrets'

import {
  wrapUntrustedContext,
  wrapUntrustedToolOutput,
} from './untrusted-context'
import { YoutubeTranscript, isYoutubeUrl } from './youtube-transcript'

const MAX_URL_MENTIONS = 5
const MAX_WEBSITE_CONTENT_CHARS = 200_000
const MAX_DIRECT_PROMPT_FILE_BYTES = 512 * 1024
const MAX_BLOCK_CONTEXT_CHARS = 512 * 1024
const MAX_PROMPT_TEXT_CHARS = 2 * 1024 * 1024
const MAX_PROMPT_IMAGE_CHARS = 32 * 1024 * 1024

export class PromptGenerator {
  private getRagEngine: () => Promise<RAGEngine>
  private app: App
  private settings: SmartComposerSettings
  private MAX_CONTEXT_TURNS = 10

  constructor(
    getRagEngine: () => Promise<RAGEngine>,
    app: App,
    settings: SmartComposerSettings,
  ) {
    this.getRagEngine = getRagEngine
    this.app = app
    this.settings = settings
  }

  public async generateRequestMessages({
    messages,
  }: {
    messages: ChatMessage[]
  }): Promise<RequestMessage[]> {
    if (messages.length === 0) {
      throw new Error('No messages provided')
    }

    const compiledMessages = [...messages]
    let lastUserMessageIndex = -1
    for (let i = 0; i < compiledMessages.length; ++i) {
      const message = compiledMessages[i]
      if (message.role !== 'user') continue
      lastUserMessageIndex = i
      if (message.promptContent) continue

      const { promptContent, similaritySearchResults } =
        await this.compileUserMessagePrompt({ message })
      compiledMessages[i] = {
        ...message,
        promptContent,
        similaritySearchResults,
      }
    }
    if (lastUserMessageIndex === -1) {
      throw new Error('No user messages found')
    }

    const lastUserMessage = compiledMessages[
      lastUserMessageIndex
    ] as ChatUserMessage
    const shouldUseRAG = lastUserMessage.similaritySearchResults !== undefined
    const hasFileOnlyRag =
      lastUserMessage.similaritySearchResults?.some(
        ({ metadata }) => getVectorLineRange(metadata) === null,
      ) ?? false

    const systemMessage = this.getSystemMessage(shouldUseRAG, hasFileOnlyRag)

    const customInstructionMessage = this.getCustomInstructionMessage()

    const currentFile = lastUserMessage.mentionables.find(
      (m) => m.type === 'current-file',
    )?.file
    const currentFileMessage =
      currentFile && this.settings.chatOptions.includeCurrentFileContent
        ? await this.getCurrentFileMessage(currentFile)
        : undefined

    const requestMessages: RequestMessage[] = [
      systemMessage,
      ...(customInstructionMessage ? [customInstructionMessage] : []),
      ...(currentFileMessage ? [currentFileMessage] : []),
      ...this.getChatHistoryMessages({ messages: compiledMessages }),
      ...(shouldUseRAG && this.getModelPromptLevel() == PromptLevel.Default
        ? [this.getRagInstructionMessage(hasFileOnlyRag)]
        : []),
    ]

    assertPromptBudget(requestMessages)
    return requestMessages
  }

  private getChatHistoryMessages({
    messages,
  }: {
    messages: ChatMessage[]
  }): RequestMessage[] {
    const contextMessages = getLastChatTurns(messages, this.MAX_CONTEXT_TURNS)
    const requestMessages: RequestMessage[] = contextMessages.flatMap(
      (message): RequestMessage[] => {
        if (message.role === 'user') {
          return [
            {
              role: 'user',
              content:
                message.promptContent ??
                (message.content
                  ? editorStateToPlainText(message.content).trim()
                  : ''),
            },
          ]
        } else if (message.role === 'assistant') {
          return this.parseAssistantMessage({ message })
        } else if (message.role === 'tool') {
          // message.role === 'tool'
          return this.parseToolMessage({ message })
        } else {
          return [this.parseAgentCommandMessage({ message })]
        }
      },
    )

    // TODO: Also verify that tool messages appear right after their corresponding assistant tool calls
    const filteredRequestMessages: RequestMessage[] = requestMessages
      .map((msg) => {
        switch (msg.role) {
          case 'user':
            return msg
          case 'assistant': {
            // Filter out tool calls that don't have a corresponding tool message
            const filteredToolCalls = msg.tool_calls?.filter((t) =>
              requestMessages.some(
                (rm) => rm.role === 'tool' && rm.tool_call.id === t.id,
              ),
            )
            return {
              ...msg,
              tool_calls:
                filteredToolCalls && filteredToolCalls.length > 0
                  ? filteredToolCalls
                  : undefined,
            }
          }
          case 'tool': {
            // Filter out tool messages that don't have a corresponding assistant message
            const assistantMessage = requestMessages.find(
              (rm) =>
                rm.role === 'assistant' &&
                rm.tool_calls?.some((t) => t.id === msg.tool_call.id),
            )
            if (!assistantMessage) {
              return null
            } else {
              return msg
            }
          }
          default:
            return msg
        }
      })
      .filter((m) => m !== null)

    return filteredRequestMessages
  }

  private parseAssistantMessage({
    message,
  }: {
    message: ChatAssistantMessage
  }): RequestMessage[] {
    let citationContent: string | null = null
    if (message.annotations && message.annotations.length > 0) {
      citationContent = `Citations:
${message.annotations
  .map((annotation, index) => {
    if (annotation.type === 'url_citation') {
      const { url, title } = annotation.url_citation
      return `[${index + 1}] ${title ? `${title}: ` : ''}${url}`
    }
  })
  .join('\n')}`
    }

    return [
      {
        role: 'assistant',
        content: [
          message.content,
          ...(citationContent ? [citationContent] : []),
        ].join('\n'),
        tool_calls: message.toolCallRequests,
        providerMetadata: message.providerMetadata,
      },
    ]
  }

  private parseToolMessage({
    message,
  }: {
    message: ChatToolMessage
  }): RequestMessage[] {
    return message.toolCalls.map((toolCall) => {
      switch (toolCall.response.status) {
        case ToolCallResponseStatus.PendingApproval:
        case ToolCallResponseStatus.Running:
        case ToolCallResponseStatus.Rejected:
        case ToolCallResponseStatus.Aborted:
          return {
            role: 'tool',
            tool_call: toolCall.request,
            content: `Tool call ${toolCall.request.id} is ${toolCall.response.status}`,
          }
        case ToolCallResponseStatus.Success:
          return {
            role: 'tool',
            tool_call: toolCall.request,
            content: wrapUntrustedToolOutput(toolCall.response.data.text),
          }
        case ToolCallResponseStatus.Error:
          return {
            role: 'tool',
            tool_call: toolCall.request,
            content: `Error:
${wrapUntrustedToolOutput(toolCall.response.error)}`,
          }
      }
    })
  }

  private parseAgentCommandMessage({
    message,
  }: {
    message: ChatAgentCommandMessage
  }): RequestMessage {
    return {
      role: 'assistant',
      content: [
        [message.title, message.detail].filter(Boolean).join(' '),
        `Status: ${message.status}`,
        ...(message.exitCode !== undefined
          ? [`Exit code: ${message.exitCode ?? 'running'}`]
          : []),
        message.input,
        message.output,
      ]
        .filter((line) => line.length > 0)
        .join('\n'),
    }
  }

  public async compileUserMessagePrompt({
    message,
    useVaultSearch,
    onQueryProgressChange,
    signal,
  }: {
    message: ChatUserMessage
    useVaultSearch?: boolean
    onQueryProgressChange?: (queryProgress: QueryProgressState) => void
    signal?: AbortSignal
  }): Promise<{
    promptContent: ChatUserMessage['promptContent']
    shouldUseRAG: boolean
    similaritySearchResults?: (Omit<SelectEmbedding, 'embedding'> & {
      similarity: number
    })[]
  }> {
    try {
      signal?.throwIfAborted()
      if (!message.content) {
        return {
          promptContent: '',
          shouldUseRAG: false,
        }
      }
      const query = editorStateToPlainText(message.content)
      let similaritySearchResults = undefined

      const searchEntireVault = Boolean(
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        useVaultSearch ||
          message.mentionables.some(
            (m): m is MentionableVault => m.type === 'vault',
          ),
      )

      onQueryProgressChange?.({
        type: 'reading-mentionables',
      })
      const currentFile = message.mentionables.find(
        (mentionable) => mentionable.type === 'current-file',
      )?.file
      const files = [
        ...message.mentionables
          .filter((m): m is MentionableFile => m.type === 'file')
          .map((m) => m.file),
        ...(this.settings.chatOptions.includeCurrentFileContent &&
        currentFile &&
        currentFile.stat.size > MAX_DIRECT_PROMPT_FILE_BYTES
          ? [currentFile]
          : []),
      ]
      const folders = message.mentionables
        .filter((m): m is MentionableFolder => m.type === 'folder')
        .map((m) => m.folder)
      const allFiles = searchEntireVault
        ? []
        : [
            ...new Map(
              [
                ...files,
                ...folders.flatMap((folder) =>
                  getNestedFiles(folder, this.app.vault).filter(
                    (file) => file.extension === 'md',
                  ),
                ),
              ].map((file) => [file.path, file]),
            ).values(),
          ]
      const fileContents: string[] = []
      let shouldUseRAG = searchEntireVault
      let mentionedFileTokens = 0
      for (const file of allFiles) {
        signal?.throwIfAborted()
        if (file.stat.size > MAX_DIRECT_PROMPT_FILE_BYTES) {
          shouldUseRAG = true
          break
        }
        const estimatedFileTokens = Math.ceil(file.stat.size / 2)
        if (
          mentionedFileTokens + estimatedFileTokens >
          this.settings.ragOptions.thresholdTokens
        ) {
          shouldUseRAG = true
          break
        }
        const content = await readTFileContent(file, this.app.vault)
        signal?.throwIfAborted()
        fileContents.push(content)
        mentionedFileTokens += await tokenCount(content)
        if (mentionedFileTokens > this.settings.ragOptions.thresholdTokens) {
          shouldUseRAG = true
          break
        }
      }

      let filePrompt: string
      if (shouldUseRAG) {
        similaritySearchResults = searchEntireVault
          ? await (
              await this.getRagEngine()
            ).processQuery({
              query,
              onQueryProgressChange: onQueryProgressChange,
              signal,
            }) // TODO: Add similarity boosting for mentioned files or folders
          : await (
              await this.getRagEngine()
            ).processQuery({
              query,
              scope: {
                files: files.map((f) => f.path),
                folders: folders.map((f) => f.path),
              },
              onQueryProgressChange: onQueryProgressChange,
              signal,
            })
        const modelPromptLevel = this.getModelPromptLevel()
        filePrompt = `## Potentially Relevant Snippets from the current vault
${wrapUntrustedContext(
  similaritySearchResults
    .map(({ path, content, metadata }) => {
      const lineRange = getVectorLineRange(metadata)
      const newContent =
        modelPromptLevel == PromptLevel.Default && lineRange
          ? this.addLineNumbersToContent({
              content,
              startLine: lineRange.startLine,
            })
          : content
      return `\`\`\`${path}\n${newContent}\n\`\`\`\n`
    })
    .join(''),
)}\n`
      } else {
        filePrompt = wrapUntrustedContext(
          allFiles
            .map((file, index) => {
              return `\`\`\`${file.path}\n${fileContents[index]}\n\`\`\`\n`
            })
            .join(''),
        )
      }

      const blocks = message.mentionables.filter(
        (m): m is MentionableBlock => m.type === 'block',
      )
      if (
        blocks.reduce((length, block) => length + block.content.length, 0) >
        MAX_BLOCK_CONTEXT_CHARS
      ) {
        throw new Error('Referenced block content is too large')
      }
      const blockPrompt = wrapUntrustedContext(
        blocks
          .map(({ file, content }) => {
            return `\`\`\`${file.path}\n${content}\n\`\`\`\n`
          })
          .join(''),
      )
      const urls = [
        ...new Map(
          message.mentionables
            .filter((m): m is MentionableUrl => m.type === 'url')
            .map((mentionable) => [mentionable.url, mentionable]),
        ).values(),
      ]
        .filter(({ url }) => isPublicHttpUrl(url))
        .slice(0, MAX_URL_MENTIONS)

      const urlPrompt =
        urls.length > 0
          ? `## Potentially Relevant Websearch Results
${wrapUntrustedContext(
  (
    await Promise.all(
      urls.map(
        async ({ url }) => `\`\`\`
Website URL: ${url}
Website Content:
${await this.getWebsiteContent(url, signal)}
\`\`\``,
      ),
    )
  ).join('\n'),
)}
`
          : ''

      const imageDataUrls = message.mentionables
        .filter((m): m is MentionableImage => m.type === 'image')
        .map(({ data }) => data)

      // Reset query progress
      onQueryProgressChange?.({
        type: 'idle',
      })

      return {
        promptContent: [
          ...imageDataUrls.map(
            (data): ContentPart => ({
              type: 'image_url',
              image_url: {
                url: data,
              },
            }),
          ),
          {
            type: 'text',
            text: `${filePrompt}${blockPrompt}${urlPrompt}\n\n${query}\n\n`,
          },
        ],
        shouldUseRAG,
        similaritySearchResults: similaritySearchResults,
      }
    } catch (error) {
      if (!signal?.aborted) {
        console.error('Failed to compile user message', redactSecrets(error))
      }
      onQueryProgressChange?.({
        type: 'idle',
      })
      throw error
    }
  }

  private getSystemMessage(
    shouldUseRAG: boolean,
    hasFileOnlyRag: boolean,
  ): RequestMessage {
    const modelPromptLevel = this.getModelPromptLevel()
    const systemPrompt = `You are an intelligent assistant to help answer any questions that the user has${modelPromptLevel == PromptLevel.Default ? `, particularly about editing and organizing markdown files in Obsidian` : ''}.

1. Please keep your response as concise as possible. Avoid being verbose.

2. Do not lie or make up facts.

3. Format your response in markdown.

${
  modelPromptLevel == PromptLevel.Default
    ? `4. Respond in the same language as the user's message.

5. When writing out new markdown blocks, also wrap them with <smtcmp_block> tags. For example:
<smtcmp_block language="markdown">
{{ content }}
</smtcmp_block>

6. When providing markdown blocks for an existing file, add the filename and language attributes to the <smtcmp_block> tags. Restate the relevant section or heading, so the user knows which part of the file you are editing. For example:
<smtcmp_block filename="path/to/file.md" language="markdown">
## Section Title
...
{{ content }}
...
</smtcmp_block>

7. When the user is asking for edits to their markdown, please provide a simplified version of the markdown block emphasizing only the changes. Use comments to show where unchanged content has been skipped. Wrap the markdown block with <smtcmp_block> tags. Add filename and language attributes to the <smtcmp_block> tags. For example:
<smtcmp_block filename="path/to/file.md" language="markdown">
<!-- ... existing content ... -->
{{ edit_1 }}
<!-- ... existing content ... -->
{{ edit_2 }}
<!-- ... existing content ... -->
</smtcmp_block>
The user has full access to the file, so they prefer seeing only the changes in the markdown. Often this will mean that the start/end of the file will be skipped, but that's okay! Rewrite the entire file only if specifically requested. Always provide a brief explanation of the updates, except when the user specifically asks for just the content.
`
    : ''
}`

    const systemPromptRAG = `You are an intelligent assistant to help answer any questions that the user has${modelPromptLevel == PromptLevel.Default ? `, particularly about editing and organizing markdown files in Obsidian` : ''}. You will be given your conversation history with them and potentially relevant blocks of markdown content from the current vault.
      
1. Do not lie or make up facts.

2. Format your response in markdown.

${
  modelPromptLevel == PromptLevel.Default
    ? `3. Respond in the same language as the user's message.

4. When referencing markdown blocks in your answer, keep the following guidelines in mind:

  a. Never include line numbers in the output markdown.

  b. Wrap the markdown block with <smtcmp_block> tags. Include language attribute. For example:
  <smtcmp_block language="markdown">
  {{ content }}
  </smtcmp_block>

  c. When providing markdown blocks for an existing file, also include the filename attribute to the <smtcmp_block> tags. For example:
  <smtcmp_block filename="path/to/file.md" language="markdown">
  {{ content }}
  </smtcmp_block>

  d. ${
    hasFileOnlyRag
      ? `Some referenced snippets are file-only contextual snippets without exact line ranges. Cite those snippets by filename/path and relevant content only; do not invent startLine or endLine attributes for file-only snippets.`
      : `When referencing a markdown block the user gives you, only add the startLine and endLine attributes to the <smtcmp_block> tags. Write related content outside of the <smtcmp_block> tags. The content inside the <smtcmp_block> tags will be ignored and replaced with the actual content of the markdown block. For example:
  <smtcmp_block filename="path/to/file.md" language="markdown" startLine="2" endLine="30"></smtcmp_block>`
  }`
    : ''
}`

    return {
      role: 'system',
      content: shouldUseRAG ? systemPromptRAG : systemPrompt,
    }
  }

  private getCustomInstructionMessage(): RequestMessage | null {
    const customInstruction = this.settings.systemPrompt.trim()
    if (!customInstruction) {
      return null
    }
    return {
      role: 'user',
      content: `Here are additional instructions to follow in your responses when relevant. There's no need to explicitly acknowledge them:
<custom_instructions>
${customInstruction}
</custom_instructions>`,
    }
  }

  private async getCurrentFileMessage(
    currentFile: TFile,
  ): Promise<RequestMessage | null> {
    if (currentFile.stat.size > MAX_DIRECT_PROMPT_FILE_BYTES) {
      return null
    }
    const fileContent = await readTFileContent(currentFile, this.app.vault)
    return {
      role: 'user',
      content: `# Inputs
## Current File
Here is the file I'm looking at.
${wrapUntrustedContext(`\`\`\`${currentFile.path}
${fileContent}
\`\`\``)}\n\n`,
    }
  }

  private getRagInstructionMessage(hasFileOnlyRag: boolean): RequestMessage {
    if (hasFileOnlyRag) {
      return {
        role: 'user',
        content: `Some markdown snippets I gave you are file-only contextual snippets. If you reference them, cite the filename/path and relevant content in prose, and do not include startLine or endLine attributes for those file-only snippets.

When writing out new markdown blocks, remember not to include "line_number|" at the beginning of each line.`,
      }
    }
    return {
      role: 'user',
      content: `If you need to reference any of the markdown blocks I gave you, add the startLine and endLine attributes to the <smtcmp_block> tags without any content inside. For example:
<smtcmp_block filename="path/to/file.md" language="markdown" startLine="200" endLine="310"></smtcmp_block>

When writing out new markdown blocks, remember not to include "line_number|" at the beginning of each line.`,
    }
  }

  private addLineNumbersToContent({
    content,
    startLine,
  }: {
    content: string
    startLine: number
  }): string {
    const lines = content.split('\n')
    const linesWithNumbers = lines.map((line, index) => {
      return `${startLine + index}|${line}`
    })
    return linesWithNumbers.join('\n')
  }

  /**
   * TODO: Improve markdown conversion logic
   * - filter visually hidden elements
   * ...
   */
  private async getWebsiteContent(
    url: string,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      if (isYoutubeUrl(url)) {
        // TODO: pass language based on user preferences
        const { title, transcript } =
          await YoutubeTranscript.fetchTranscriptAndMetadata(url, { signal })

        return `Title: ${title}
Video Transcript:
${transcript.map((t) => `${t.offset}: ${t.text}`).join('\n')}`.slice(
          0,
          MAX_WEBSITE_CONTENT_CHARS,
        )
      }

      const response = await fetchPublicUrl(url, { signal })
      return htmlToMarkdown(response.text).slice(0, MAX_WEBSITE_CONTENT_CHARS)
    } catch (error) {
      if (signal?.aborted) throw error
      console.warn(
        'Website content could not be fetched safely:',
        redactSecrets(error),
      )
      return 'Website content unavailable.'
    }
  }

  private getModelPromptLevel(): PromptLevel {
    const chatModel = this.settings.chatModels.find(
      (model) => model.id === this.settings.chatModelId,
    )
    return chatModel?.promptLevel ?? PromptLevel.Default
  }
}

function assertPromptBudget(messages: RequestMessage[]): void {
  let textChars = 0
  let imageChars = 0

  for (const message of messages) {
    if (typeof message.content === 'string') {
      textChars += message.content.length
    } else {
      for (const part of message.content) {
        if (part.type === 'text') textChars += part.text.length
        else imageChars += part.image_url.url.length
      }
    }
    if (message.role === 'assistant') {
      textChars +=
        message.tool_calls?.reduce(
          (length, toolCall) =>
            length + toolCall.name.length + (toolCall.arguments?.length ?? 0),
          0,
        ) ?? 0
    } else if (message.role === 'tool') {
      textChars +=
        message.tool_call.name.length +
        (message.tool_call.arguments?.length ?? 0)
    }

    if (
      textChars > MAX_PROMPT_TEXT_CHARS ||
      imageChars > MAX_PROMPT_IMAGE_CHARS
    ) {
      throw new Error('Compiled prompt is too large')
    }
  }
}

export function getLastChatTurns(
  messages: readonly ChatMessage[],
  maxTurns: number,
): ChatMessage[] {
  if (maxTurns <= 0) {
    return []
  }

  let turnsSeen = 0
  let startIndex = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== 'user') {
      continue
    }
    turnsSeen += 1
    startIndex = index
    if (turnsSeen === maxTurns) {
      break
    }
  }

  return messages.slice(startIndex)
}
