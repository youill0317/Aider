import { v4 as uuidv4 } from 'uuid'

import type {
  CodexPermissionDecision,
  CodexPermissionRequest,
} from '../../core/agent/types'
import { BaseLLMProvider } from '../../core/llm/base'
import { ChatMessage, ChatToolMessage } from '../../types/chat'
import { ChatModel } from '../../types/chat-model.types'
import {
  Annotation,
  LLMResponseStreaming,
  ResponseProviderMetadata,
  ToolCallDelta,
} from '../../types/llm/response'
import { LLMProvider } from '../../types/provider.types'
import {
  ToolCallRequest,
  ToolCallResponseStatus,
} from '../../types/tool-call.types'

import { fetchAnnotationTitles } from './fetch-annotation-titles'
import { PromptGenerator } from './promptGenerator'
import type { ToolDispatcher } from './tool-dispatcher'

const MAX_ASSISTANT_TEXT_CHARS = 2 * 1024 * 1024
const MAX_TOOL_CALL_ARGUMENT_CHARS = 1024 * 1024
const MAX_TOOL_CALLS_PER_RESPONSE = 64
const MAX_ANNOTATIONS_PER_RESPONSE = 512
const MAX_ANNOTATION_TEXT_CHARS = 16_384
const MAX_TOOL_CALL_ID_CHARS = 256
const MAX_TOOL_CALL_NAME_CHARS = 512
const RESPONSE_PUBLISH_BATCH_CHARS = 8 * 1024
const RESPONSE_PUBLISH_INTERVAL_MS = 50
const MAX_PENDING_STREAM_CHUNKS = 512

export type ResponseGeneratorParams = {
  providerClient: BaseLLMProvider<LLMProvider>
  model: ChatModel
  messages: ChatMessage[]
  conversationId: string
  enableTools: boolean
  maxAutoIterations: number
  promptGenerator: PromptGenerator
  toolDispatcher: ToolDispatcher
  abortSignal?: AbortSignal
  isToolsEnabled?: () => boolean
  onPermissionRequest?: (
    request: CodexPermissionRequest,
  ) => Promise<CodexPermissionDecision | null>
}

export class ResponseGenerator {
  private readonly providerClient: BaseLLMProvider<LLMProvider>
  private readonly model: ChatModel
  private readonly conversationId: string
  private readonly enableTools: boolean
  private readonly isToolsEnabled: () => boolean
  private readonly promptGenerator: PromptGenerator
  private readonly toolDispatcher: ToolDispatcher
  private readonly abortSignal?: AbortSignal
  private readonly onPermissionRequest?: (
    request: CodexPermissionRequest,
  ) => Promise<CodexPermissionDecision | null>
  private readonly receivedMessages: ChatMessage[]
  private readonly maxAutoIterations: number

  private responseMessages: ChatMessage[] = [] // Response messages that are generated after the initial messages
  private subscribers: ((messages: ChatMessage[]) => void)[] = []
  private pendingAnnotationTitleFetches = new Set<Promise<void>>()

  constructor(params: ResponseGeneratorParams) {
    this.providerClient = params.providerClient
    this.model = params.model
    this.conversationId = params.conversationId
    this.enableTools = params.enableTools
    this.isToolsEnabled = params.isToolsEnabled ?? (() => this.enableTools)
    this.maxAutoIterations = Math.max(1, Math.floor(params.maxAutoIterations))
    this.receivedMessages = params.messages
    this.promptGenerator = params.promptGenerator
    this.toolDispatcher = params.toolDispatcher
    this.abortSignal = params.abortSignal
    this.onPermissionRequest = params.onPermissionRequest
  }

  public subscribe(callback: (messages: ChatMessage[]) => void) {
    this.subscribers.push(callback)

    return () => {
      this.subscribers = this.subscribers.filter((cb) => cb !== callback)
    }
  }

  public async run() {
    let remainingAutoToolCalls = this.maxAutoIterations
    for (;;) {
      const { toolCallRequests } = await this.streamSingleResponse()
      if (toolCallRequests.length === 0) {
        return
      }
      if (!this.isToolsEnabled()) {
        return
      }

      const toolMessage: ChatToolMessage = {
        role: 'tool' as const,
        id: uuidv4(),
        toolCalls: toolCallRequests.map((toolCall) => {
          const shouldRun =
            remainingAutoToolCalls > 0 &&
            this.toolDispatcher.isToolExecutionAllowed({
              requestToolName: toolCall.name,
              requestArgs: toolCall.arguments,
              conversationId: this.conversationId,
            })
          if (shouldRun) remainingAutoToolCalls -= 1
          return {
            request: toolCall,
            response: {
              status: shouldRun
                ? ToolCallResponseStatus.Running
                : ToolCallResponseStatus.PendingApproval,
            },
          }
        }),
      }

      this.updateResponseMessages((messages) => [...messages, toolMessage])

      await Promise.all(
        toolMessage.toolCalls
          .filter(
            (toolCall) =>
              toolCall.response.status === ToolCallResponseStatus.Running,
          )
          .map(async (toolCall) => {
            const response = await this.toolDispatcher.callTool({
              name: toolCall.request.name,
              args: toolCall.request.arguments,
              id: toolCall.request.id,
              onPermissionRequest: this.onPermissionRequest,
              signal: this.abortSignal,
            })
            this.updateResponseMessages((messages) =>
              messages.map((message) =>
                message.id === toolMessage.id && message.role === 'tool'
                  ? {
                      ...message,
                      toolCalls: message.toolCalls?.map((tc) =>
                        tc.request.id === toolCall.request.id
                          ? {
                              ...tc,
                              response,
                            }
                          : tc,
                      ),
                    }
                  : message,
              ),
            )
          }),
      )

      const updatedToolMessage = this.responseMessages.find(
        (message) => message.id === toolMessage.id && message.role === 'tool',
      ) as ChatToolMessage | undefined
      if (
        !updatedToolMessage?.toolCalls?.every((toolCall) =>
          [
            ToolCallResponseStatus.Success,
            ToolCallResponseStatus.Error,
          ].includes(toolCall.response.status),
        )
      ) {
        // Exit the auto-iteration loop if any tool call hasn't completed
        // Only 'success' or 'error' states are considered complete
        return
      }
    }
  }

  private async streamSingleResponse(): Promise<{
    toolCallRequests: ToolCallRequest[]
  }> {
    const requestMessages = await this.promptGenerator.generateRequestMessages({
      messages: [...this.receivedMessages, ...this.responseMessages],
    })

    const listedTools = this.isToolsEnabled()
      ? await this.toolDispatcher.listAvailableTools()
      : []
    const tools = this.isToolsEnabled() ? listedTools : []
    const requestTools = tools.length > 0 ? tools : undefined
    const advertisedToolNames = new Set(tools.map((tool) => tool.function.name))

    const stream = await this.providerClient.streamResponse(
      this.model,
      {
        model: this.model.model,
        messages: requestMessages,
        tools: requestTools,
        stream: true,
      },
      {
        signal: this.abortSignal,
      },
    )

    // Create a new assistant message for the response if it doesn't exist
    if (this.responseMessages.at(-1)?.role !== 'assistant') {
      this.responseMessages.push({
        role: 'assistant',
        content: '',
        id: uuidv4(),
        metadata: {
          model: this.model,
        },
      })
    }
    const lastMessage = this.responseMessages.at(-1)
    if (lastMessage?.role !== 'assistant') {
      throw new Error('Last message is not an assistant message')
    }
    const responseMessageId = lastMessage.id
    let responseToolCalls: Record<number, ToolCallDelta> = {}
    let pendingChunks: LLMResponseStreaming[] = []
    let pendingChars = 0
    let lastPublishAt = 0
    const flushPendingChunks = () => {
      if (pendingChunks.length === 0) return
      const { updatedToolCalls } = this.processChunk(
        mergeStreamingChunks(pendingChunks),
        responseMessageId,
        responseToolCalls,
      )
      responseToolCalls = updatedToolCalls
      pendingChunks = []
      pendingChars = 0
      lastPublishAt = Date.now()
    }
    for await (const chunk of stream) {
      pendingChunks.push(chunk)
      pendingChars += getStreamingDeltaChars(chunk)
      if (
        lastPublishAt === 0 ||
        pendingChars >= RESPONSE_PUBLISH_BATCH_CHARS ||
        pendingChunks.length >= MAX_PENDING_STREAM_CHUNKS ||
        Date.now() - lastPublishAt >= RESPONSE_PUBLISH_INTERVAL_MS
      ) {
        flushPendingChunks()
      }
    }
    flushPendingChunks()
    const toolCallRequests: ToolCallRequest[] = Object.values(responseToolCalls)
      .map((toolCall) => {
        // filter out invalid tool calls without a name
        if (!toolCall.function?.name) {
          return null
        }
        if (
          !this.isToolsEnabled() ||
          !advertisedToolNames.has(toolCall.function.name)
        ) {
          return null
        }
        return {
          id: toolCall.id ?? uuidv4(),
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        }
      })
      .filter((toolCall) => toolCall !== null)

    this.updateResponseMessages((messages) =>
      messages.map((message) =>
        message.id === responseMessageId && message.role === 'assistant'
          ? {
              ...message,
              toolCallRequests:
                toolCallRequests.length > 0 ? toolCallRequests : undefined,
            }
          : message,
      ),
    )
    if (!this.abortSignal?.aborted) {
      await Promise.allSettled([...this.pendingAnnotationTitleFetches])
    }
    return {
      toolCallRequests: toolCallRequests,
    }
  }

  private processChunk(
    chunk: LLMResponseStreaming,
    responseMessageId: string,
    responseToolCalls: Record<number, ToolCallDelta>,
  ): {
    updatedToolCalls: Record<number, ToolCallDelta>
  } {
    const content = chunk.choices[0]?.delta?.content ?? ''
    const reasoning = chunk.choices[0]?.delta?.reasoning
    const toolCalls = chunk.choices[0]?.delta?.tool_calls
    const annotations = chunk.choices[0]?.delta?.annotations

    if (annotations && annotations.length > MAX_ANNOTATIONS_PER_RESPONSE) {
      throw new Error('Assistant response has too many annotations')
    }
    if (annotations) this.validateAnnotations(annotations)

    const updatedToolCalls = toolCalls
      ? this.mergeToolCallDeltas(toolCalls, responseToolCalls)
      : responseToolCalls

    if (annotations) {
      // For annotations with empty titles, fetch the title of the URL and update the chat messages
      const titleFetch = fetchAnnotationTitles(annotations, (url, title) => {
        this.updateResponseMessages((messages) =>
          messages.map((message) =>
            message.id === responseMessageId && message.role === 'assistant'
              ? {
                  ...message,
                  annotations: message.annotations?.map((a) =>
                    a.type === 'url_citation' && a.url_citation.url === url
                      ? {
                          ...a,
                          url_citation: {
                            ...a.url_citation,
                            title: title ?? undefined,
                          },
                        }
                      : a,
                  ),
                }
              : message,
          ),
        )
      })
      this.pendingAnnotationTitleFetches.add(titleFetch)
      void titleFetch.finally(() => {
        this.pendingAnnotationTitleFetches.delete(titleFetch)
      })
    }

    const providerMetadata = chunk.choices[0]?.delta?.providerMetadata

    this.updateResponseMessages((messages) =>
      messages.map((message) =>
        message.id === responseMessageId && message.role === 'assistant'
          ? this.appendAssistantDelta(message, {
              annotations,
              content,
              providerMetadata,
              reasoning,
              usage: chunk.usage,
            })
          : message,
      ),
    )

    return {
      updatedToolCalls,
    }
  }

  private updateResponseMessages(
    updaterFunction: (messages: ChatMessage[]) => ChatMessage[],
  ) {
    this.responseMessages = updaterFunction(this.responseMessages)
    this.notifySubscribers(this.responseMessages)
  }

  private notifySubscribers(messages: ChatMessage[]) {
    this.subscribers.forEach((callback) => {
      try {
        callback(messages)
      } catch {
        console.error('Chat response subscriber failed')
      }
    })
  }

  private appendAssistantDelta(
    message: Extract<ChatMessage, { role: 'assistant' }>,
    delta: {
      annotations?: Annotation[]
      content: string
      providerMetadata: LLMResponseStreaming['choices'][number]['delta']['providerMetadata']
      reasoning?: string | null
      usage?: LLMResponseStreaming['usage']
    },
  ): Extract<ChatMessage, { role: 'assistant' }> {
    const content = message.content + delta.content
    const reasoning = delta.reasoning
      ? (message.reasoning ?? '') + delta.reasoning
      : message.reasoning
    if (content.length + (reasoning?.length ?? 0) > MAX_ASSISTANT_TEXT_CHARS) {
      throw new Error('Assistant response is too large')
    }

    return {
      ...message,
      content,
      reasoning,
      annotations: this.mergeAnnotations(
        message.annotations,
        delta.annotations,
      ),
      metadata: {
        ...message.metadata,
        usage: delta.usage ?? message.metadata?.usage,
      },
      providerMetadata: mergeProviderMetadata(
        message.providerMetadata,
        delta.providerMetadata,
      ),
    }
  }

  private mergeToolCallDeltas(
    toolCalls: ToolCallDelta[],
    existingToolCalls: Record<number, ToolCallDelta>,
  ): Record<number, ToolCallDelta> {
    const merged = { ...existingToolCalls }
    const argumentParts = new Map<number, string[]>()

    for (const toolCall of toolCalls) {
      const { index } = toolCall

      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= MAX_TOOL_CALLS_PER_RESPONSE
      ) {
        throw new Error('Assistant response has too many tool calls')
      }
      if (
        toolCall.id !== undefined &&
        (typeof toolCall.id !== 'string' ||
          toolCall.id.length === 0 ||
          toolCall.id.length > MAX_TOOL_CALL_ID_CHARS)
      ) {
        throw new Error('Assistant tool call ID is invalid')
      }
      if (
        toolCall.function?.name !== undefined &&
        (typeof toolCall.function.name !== 'string' ||
          toolCall.function.name.length === 0 ||
          toolCall.function.name.length > MAX_TOOL_CALL_NAME_CHARS)
      ) {
        throw new Error('Assistant tool call name is invalid')
      }

      const mergedToolCall: ToolCallDelta = {
        index,
        id: merged[index]?.id ?? toolCall.id,
        type: merged[index]?.type ?? toolCall.type,
      }

      if (merged[index]?.function || toolCall.function) {
        const newArgs = toolCall.function?.arguments
        if (newArgs !== undefined) {
          if (typeof newArgs !== 'string') {
            throw new Error('Assistant tool call arguments are invalid')
          }
          const parts = argumentParts.get(index) ?? []
          parts.push(newArgs)
          argumentParts.set(index, parts)
        }
        mergedToolCall.function = {
          name: merged[index]?.function?.name ?? toolCall.function?.name,
          arguments: merged[index]?.function?.arguments,
        }
      }

      merged[index] = mergedToolCall
    }

    for (const [index, parts] of argumentParts) {
      const existingArguments =
        existingToolCalls[index]?.function?.arguments ?? ''
      const totalLength = parts.reduce(
        (length, part) => length + part.length,
        existingArguments.length,
      )
      if (totalLength > MAX_TOOL_CALL_ARGUMENT_CHARS) {
        throw new Error('Assistant tool call arguments are too large')
      }
      const toolCall = merged[index]
      if (toolCall.function) {
        toolCall.function.arguments = [existingArguments, ...parts].join('')
      }
    }

    return merged
  }

  private validateAnnotations(annotations: Annotation[]): void {
    for (const annotation of annotations) {
      const citation = annotation?.url_citation
      if (
        annotation?.type !== 'url_citation' ||
        typeof citation?.url !== 'string' ||
        citation.url.length > MAX_ANNOTATION_TEXT_CHARS ||
        (citation.title !== undefined &&
          (typeof citation.title !== 'string' ||
            citation.title.length > MAX_ANNOTATION_TEXT_CHARS)) ||
        !isOptionalNonnegativeInteger(citation.start_index) ||
        !isOptionalNonnegativeInteger(citation.end_index)
      ) {
        throw new Error('Assistant response has an invalid annotation')
      }
    }
  }

  private mergeAnnotations(
    prevAnnotations?: Annotation[],
    newAnnotations?: Annotation[],
  ): Annotation[] | undefined {
    if (!prevAnnotations) return newAnnotations
    if (!newAnnotations) return prevAnnotations

    const mergedAnnotations = [...prevAnnotations]
    for (const newAnnotation of newAnnotations) {
      if (
        !mergedAnnotations.find(
          (annotation) =>
            annotation.url_citation.url === newAnnotation.url_citation.url,
        )
      ) {
        mergedAnnotations.push(newAnnotation)
      }
    }
    if (mergedAnnotations.length > MAX_ANNOTATIONS_PER_RESPONSE) {
      throw new Error('Assistant response has too many annotations')
    }
    return mergedAnnotations
  }
}

function getStreamingDeltaChars(chunk: LLMResponseStreaming): number {
  const delta = chunk.choices[0]?.delta
  return (
    (delta?.content?.length ?? 0) +
    (delta?.reasoning?.length ?? 0) +
    (delta?.tool_calls?.reduce(
      (length, toolCall) =>
        length + (toolCall.function?.arguments?.length ?? 0),
      0,
    ) ?? 0)
  )
}

function mergeStreamingChunks(
  chunks: LLMResponseStreaming[],
): LLMResponseStreaming {
  const lastChunk = chunks[chunks.length - 1]
  const deltas = chunks.map((chunk) => chunk.choices[0]?.delta)
  const content = deltas.map((delta) => delta?.content ?? '').join('')
  const reasoning = deltas.map((delta) => delta?.reasoning ?? '').join('')
  const toolCalls = deltas.flatMap((delta) => delta?.tool_calls ?? [])
  const annotations = deltas.flatMap((delta) => delta?.annotations ?? [])
  const providerMetadata = deltas.reduce<ResponseProviderMetadata | undefined>(
    (metadata, delta) =>
      mergeProviderMetadata(metadata, delta?.providerMetadata),
    undefined,
  )
  const usage = [...chunks]
    .reverse()
    .find((chunk) => chunk.usage !== undefined)?.usage

  return {
    ...lastChunk,
    ...(usage ? { usage } : {}),
    choices: [
      {
        delta: {
          ...(content ? { content } : {}),
          ...(reasoning ? { reasoning } : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          ...(annotations.length > 0 ? { annotations } : {}),
          ...(providerMetadata ? { providerMetadata } : {}),
        },
        finish_reason: lastChunk.choices[0]?.finish_reason ?? null,
      },
    ],
  }
}

function mergeProviderMetadata(
  previous?: ResponseProviderMetadata,
  next?: ResponseProviderMetadata,
): ResponseProviderMetadata | undefined {
  if (!previous) return next
  if (!next) return previous
  const reasoningContent = `${previous.deepseek?.reasoningContent ?? ''}${
    next.deepseek?.reasoningContent ?? ''
  }`
  return {
    gemini: previous.gemini ?? next.gemini,
    ...(reasoningContent ? { deepseek: { reasoningContent } } : {}),
  }
}

function isOptionalNonnegativeInteger(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && Number(value) >= 0)
}
