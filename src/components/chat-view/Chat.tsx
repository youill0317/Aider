import { useMutation } from '@tanstack/react-query'
import { Book, CircleStop, History, Plus } from 'lucide-react'
import { App, Notice } from 'obsidian'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { v4 as uuidv4 } from 'uuid'

import { ApplyViewState } from '../../ApplyView'
import { APPLY_VIEW_TYPE } from '../../constants'
import { useApp } from '../../contexts/app-context'
import { useRAG } from '../../contexts/rag-context'
import { useSettings } from '../../contexts/settings-context'
import { useToolDispatcher } from '../../contexts/tool-dispatcher-context'
import { CODEX_TOOL_NAME } from '../../core/agent/CodexToolRunner'
import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
  LLMBaseUrlNotSetException,
} from '../../core/llm/exception'
import { getChatModelClient } from '../../core/llm/manager'
import { useChatHistory } from '../../hooks/useChatHistory'
import { ChatMessage, ChatToolMessage, ChatUserMessage } from '../../types/chat'
import {
  MentionableBlock,
  MentionableBlockData,
  MentionableCurrentFile,
} from '../../types/mentionable'
import {
  ToolCallRequest,
  ToolCallResponse,
  ToolCallResponseStatus,
} from '../../types/tool-call.types'
import {
  buildAgentAssistantMessage,
  buildAgentChatRequestArgs,
  buildAgentCommandMessageFromEvent,
  buildAgentPrompt,
  getRunningAgentChatToolCallIds,
  isAgentChatTerminalMessage,
  upsertAgentCommandMessage,
  withCurrentFileMentionable,
} from '../../utils/chat/agent-chat'
import { applyChangesToFile } from '../../utils/chat/apply'
import {
  getMentionableKey,
  serializeMentionable,
} from '../../utils/chat/mentionable'
import { buildChatMessageRows } from '../../utils/chat/message-groups'
import { PromptGenerator } from '../../utils/chat/promptGenerator'
import { readTFileContent } from '../../utils/obsidian'
import { redactSecrets } from '../../utils/security/redact-secrets'
import { ErrorModal } from '../modals/ErrorModal'
import { TemplateSectionModal } from '../modals/TemplateSectionModal'

import AssistantToolMessageGroupItem from './AssistantToolMessageGroupItem'
import ChatUserInput, {
  ChatSubmitMode,
  ChatUserInputRef,
} from './chat-input/ChatUserInput'
import { editorStateToPlainText } from './chat-input/utils/editor-state-to-plain-text'
import { ChatListDropdown } from './ChatListDropdown'
import QueryProgress, { QueryProgressState } from './QueryProgress'
import { useAutoScroll } from './useAutoScroll'
import { useChatStreamManager } from './useChatStreamManager'
import UserMessageItem from './UserMessageItem'

// Add an empty line here
const getNewInputMessage = (app: App): ChatUserMessage => {
  return {
    role: 'user',
    content: null,
    promptContent: null,
    id: uuidv4(),
    mentionables: [
      {
        type: 'current-file',
        file: app.workspace.getActiveFile(),
      },
    ],
  }
}

const markRunningToolCallsAborted = (
  messages: readonly ChatMessage[],
): ChatMessage[] =>
  messages.map((message) =>
    message.role === 'tool'
      ? {
          ...message,
          toolCalls: message.toolCalls.map((toolCall) =>
            toolCall.response.status === ToolCallResponseStatus.Running
              ? {
                  ...toolCall,
                  response: { status: ToolCallResponseStatus.Aborted as const },
                }
              : toolCall,
          ),
        }
      : message,
  )

export type ChatRef = {
  openNewChat: (selectedBlock?: MentionableBlockData) => void
  addSelectionToChat: (selectedBlock: MentionableBlockData) => void
  focusMessage: () => void
  abortActiveWork: () => Promise<void>
  flushPendingSave: () => Promise<void>
}

export type ChatProps = {
  selectedBlock?: MentionableBlockData
}

type ActiveAgentToolCall = {
  readonly abortController: AbortController
  readonly toolCallId: string
}

type ActiveApprovedToolCall = {
  readonly abortController: AbortController
  readonly toolCallId: string
}

const Chat = forwardRef<ChatRef, ChatProps>((props, ref) => {
  const { selectedBlock } = props
  const app = useApp()
  const { settings, setSettings, getSettings } = useSettings()
  const { getRAGEngine } = useRAG()
  const { getToolDispatcher } = useToolDispatcher()

  const {
    createOrUpdateConversation,
    flushPendingSave: flushPendingChatSave,
    deleteConversation,
    getChatMessagesById,
    updateConversationTitle,
    chatList,
  } = useChatHistory()
  const promptGenerator = useMemo(() => {
    return new PromptGenerator(getRAGEngine, app, settings)
  }, [getRAGEngine, app, settings])

  const [inputMessage, setInputMessage] = useState<ChatUserMessage>(() => {
    const newMessage = getNewInputMessage(app)
    if (selectedBlock) {
      newMessage.mentionables = [
        ...newMessage.mentionables,
        {
          type: 'block',
          ...selectedBlock,
        },
      ]
    }
    return newMessage
  })
  const [addedBlockKey, setAddedBlockKey] = useState<string | null>(
    selectedBlock
      ? getMentionableKey(
          serializeMentionable({
            type: 'block',
            ...selectedBlock,
          }),
        )
      : null,
  )
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null)
  const [currentConversationId, setCurrentConversationId] =
    useState<string>(uuidv4())
  const [queryProgress, setQueryProgress] = useState<QueryProgressState>({
    type: 'idle',
  })
  const [activeAgentToolCallCount, setActiveAgentToolCallCount] = useState(0)

  const chatMessageRows = useMemo(
    () => buildChatMessageRows(chatMessages),
    [chatMessages],
  )

  const chatUserInputRefs = useRef<Map<string, ChatUserInputRef>>(new Map())
  const chatMessagesRef = useRef<HTMLDivElement>(null)
  const activeAgentToolCallsRef = useRef<ActiveAgentToolCall[]>([])
  const activeAgentTasksRef = useRef(new Set<Promise<void>>())
  const activeApprovedToolCallsRef = useRef<ActiveApprovedToolCall[]>([])
  const activeApprovedToolTasksRef = useRef(new Set<Promise<void>>())
  const latestChatMessagesRef = useRef(chatMessages)
  const currentConversationIdRef = useRef(currentConversationId)
  const workGenerationRef = useRef(0)
  const readyWorkGenerationRef = useRef(0)
  latestChatMessagesRef.current = chatMessages
  currentConversationIdRef.current = currentConversationId

  const { autoScrollToBottom, forceScrollToBottom } = useAutoScroll({
    scrollContainerRef: chatMessagesRef,
  })

  const { abortActiveStreams, submitChatMutation } = useChatStreamManager({
    setChatMessages,
    autoScrollToBottom,
    promptGenerator,
  })

  const registerActiveAgentToolCall = useCallback(
    (toolCallId: string, abortController: AbortController) => {
      activeAgentToolCallsRef.current = [
        ...activeAgentToolCallsRef.current,
        {
          abortController,
          toolCallId,
        },
      ]
      setActiveAgentToolCallCount(activeAgentToolCallsRef.current.length)
    },
    [],
  )

  const unregisterActiveAgentToolCall = useCallback((toolCallId: string) => {
    activeAgentToolCallsRef.current = activeAgentToolCallsRef.current.filter(
      (toolCall) => toolCall.toolCallId !== toolCallId,
    )
    setActiveAgentToolCallCount(activeAgentToolCallsRef.current.length)
  }, [])

  const abortActiveAgentToolCalls = useCallback(
    async (messages: readonly ChatMessage[]) => {
      const activeToolCalls = activeAgentToolCallsRef.current
      const activeTasks = [...activeAgentTasksRef.current]
      const toolCallIds = new Set([
        ...activeToolCalls.map((toolCall) => toolCall.toolCallId),
        ...getRunningAgentChatToolCallIds(messages),
      ])

      activeAgentToolCallsRef.current = []
      setActiveAgentToolCallCount(0)
      activeToolCalls.forEach(({ abortController }) => {
        abortController.abort()
      })
      if (activeToolCalls.length > 0) {
        const updatedMessages = [
          ...latestChatMessagesRef.current,
          buildAgentAssistantMessage('Agent Chat was stopped.'),
        ]
        latestChatMessagesRef.current = updatedMessages
        setChatMessages(updatedMessages)
      }
      if (toolCallIds.size > 0) {
        try {
          const toolDispatcher = await getToolDispatcher()
          toolCallIds.forEach((toolCallId) => {
            toolDispatcher.abortToolCall(toolCallId)
          })
        } catch (error) {
          console.error(
            'Failed to abort Agent Chat tool calls',
            redactSecrets(error),
          )
        }
      }
      await Promise.all(activeTasks.map((task) => task.catch(() => undefined)))
    },
    [getToolDispatcher],
  )

  const abortActiveApprovedToolCalls = useCallback(async () => {
    const activeToolCalls = activeApprovedToolCallsRef.current
    const activeTasks = [...activeApprovedToolTasksRef.current]
    const activeToolCallIds = new Set(
      activeToolCalls.map(({ toolCallId }) => toolCallId),
    )
    if (activeToolCallIds.size > 0) {
      const updatedMessages = latestChatMessagesRef.current.map((message) =>
        message.role === 'tool'
          ? {
              ...message,
              toolCalls: message.toolCalls.map((toolCall) =>
                activeToolCallIds.has(toolCall.request.id)
                  ? {
                      ...toolCall,
                      response: {
                        status: ToolCallResponseStatus.Aborted as const,
                      },
                    }
                  : toolCall,
              ),
            }
          : message,
      )
      latestChatMessagesRef.current = updatedMessages
      setChatMessages(updatedMessages)
    }
    activeApprovedToolCallsRef.current = []
    activeToolCalls.forEach(({ abortController }) => abortController.abort())

    const abortThroughDispatcher = (async () => {
      if (activeToolCalls.length === 0) return
      try {
        const toolDispatcher = await getToolDispatcher()
        activeToolCalls.forEach(({ toolCallId }) => {
          toolDispatcher.abortToolCall(toolCallId)
        })
      } catch (error) {
        console.error('Failed to abort tool calls', redactSecrets(error))
      }
    })()

    await Promise.all([
      abortThroughDispatcher,
      ...activeTasks.map((task) => task.catch(() => undefined)),
    ])
  }, [getToolDispatcher])

  const invalidateActiveWork = useCallback(() => {
    const generation = ++workGenerationRef.current
    readyWorkGenerationRef.current = -1
    const settled = Promise.all([
      abortActiveStreams(),
      abortActiveAgentToolCalls(latestChatMessagesRef.current),
      abortActiveApprovedToolCalls(),
    ]).then(
      () => undefined,
      (error) => {
        console.error('Failed to settle active chat work', redactSecrets(error))
      },
    )
    readyWorkGenerationRef.current = generation
    return { generation, settled }
  }, [
    abortActiveStreams,
    abortActiveAgentToolCalls,
    abortActiveApprovedToolCalls,
  ])

  const abortActiveWork = useCallback(async () => {
    const { settled } = invalidateActiveWork()
    await settled
  }, [invalidateActiveWork])

  const isCurrentWork = useCallback(
    (generation: number, conversationId: string) =>
      generation === workGenerationRef.current &&
      generation === readyWorkGenerationRef.current &&
      conversationId === currentConversationIdRef.current,
    [],
  )

  const executeApprovedToolCall = useCallback(
    async (
      request: ToolCallRequest,
      conversationId: string,
      generation: number,
      onResponseUpdate: (response: ToolCallResponse) => void,
    ) => {
      if (
        !isCurrentWork(generation, conversationId) ||
        activeApprovedToolCallsRef.current.some(
          ({ toolCallId }) => toolCallId === request.id,
        )
      ) {
        return
      }

      const abortController = new AbortController()
      activeApprovedToolCallsRef.current.push({
        abortController,
        toolCallId: request.id,
      })
      onResponseUpdate({ status: ToolCallResponseStatus.Running })

      const toolTask = (async () => {
        try {
          const toolDispatcher = await getToolDispatcher()
          if (
            abortController.signal.aborted ||
            !isCurrentWork(generation, conversationId)
          ) {
            return
          }
          const response = await toolDispatcher.callTool({
            name: request.name,
            args: request.arguments,
            id: request.id,
            signal: abortController.signal,
          })
          if (
            abortController.signal.aborted ||
            !isCurrentWork(generation, conversationId)
          ) {
            return
          }
          onResponseUpdate(response)
        } catch (error) {
          if (isCurrentWork(generation, conversationId)) {
            onResponseUpdate({
              status: ToolCallResponseStatus.Error,
              error: redactSecrets(
                error instanceof Error ? error.message : String(error),
              ),
            })
          }
        } finally {
          activeApprovedToolCallsRef.current =
            activeApprovedToolCallsRef.current.filter(
              (activeToolCall) =>
                activeToolCall.abortController !== abortController,
            )
        }
      })()

      activeApprovedToolTasksRef.current.add(toolTask)
      try {
        await toolTask
      } finally {
        activeApprovedToolTasksRef.current.delete(toolTask)
      }
    },
    [getToolDispatcher, isCurrentWork],
  )

  const flushPendingSave = useCallback(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const messages = latestChatMessagesRef.current
    if (messages.length > 0) {
      createOrUpdateConversation(currentConversationIdRef.current, messages)
    }
    await flushPendingChatSave()
  }, [createOrUpdateConversation, flushPendingChatSave])

  const registerChatUserInputRef = (
    id: string,
    ref: ChatUserInputRef | null,
  ) => {
    if (ref) {
      chatUserInputRefs.current.set(id, ref)
    } else {
      chatUserInputRefs.current.delete(id)
    }
  }

  const handleLoadConversation = async (conversationId: string) => {
    try {
      const { generation } = invalidateActiveWork()
      if (generation !== workGenerationRef.current) return
      const conversation = await getChatMessagesById(conversationId)
      if (generation !== workGenerationRef.current) return
      if (!conversation) {
        throw new Error('Conversation not found')
      }
      setCurrentConversationId(conversationId)
      setChatMessages(conversation)
      const newInputMessage = getNewInputMessage(app)
      setInputMessage(newInputMessage)
      setFocusedMessageId(newInputMessage.id)
      setQueryProgress({
        type: 'idle',
      })
    } catch (error) {
      new Notice('Failed to load conversation')
      console.error('Failed to load conversation', error)
    }
  }

  const handleNewChat = useCallback(
    (selectedBlock?: MentionableBlockData) => {
      const { generation } = invalidateActiveWork()
      if (generation !== workGenerationRef.current) return
      setCurrentConversationId(uuidv4())
      setChatMessages([])
      const newInputMessage = getNewInputMessage(app)
      if (selectedBlock) {
        const mentionableBlock: MentionableBlock = {
          type: 'block',
          ...selectedBlock,
        }
        newInputMessage.mentionables = [
          ...newInputMessage.mentionables,
          mentionableBlock,
        ]
        setAddedBlockKey(
          getMentionableKey(serializeMentionable(mentionableBlock)),
        )
      }
      setInputMessage(newInputMessage)
      setFocusedMessageId(newInputMessage.id)
      setQueryProgress({
        type: 'idle',
      })
    },
    [invalidateActiveWork, app],
  )

  const handleUserMessageSubmit = useCallback(
    async ({
      inputChatMessages,
      mode,
    }: {
      inputChatMessages: ChatMessage[]
      mode?: ChatSubmitMode
    }) => {
      const { generation } = invalidateActiveWork()
      if (generation !== workGenerationRef.current) return
      const conversationId = currentConversationIdRef.current
      const submittedMessages = markRunningToolCallsAborted(inputChatMessages)
      setQueryProgress({
        type: 'idle',
      })

      // Update the chat history to show the new user message
      setChatMessages(submittedMessages)
      requestAnimationFrame(() => {
        forceScrollToBottom()
      })

      const lastMessage = submittedMessages.at(-1)
      if (lastMessage?.role !== 'user') {
        throw new Error('Last message is not a user message')
      }
      const activeFile = app.workspace.getActiveFile()
      const messagesWithCurrentFile =
        mode === 'agent'
          ? submittedMessages.map((message) =>
              message.id === lastMessage.id && message.role === 'user'
                ? withCurrentFileMentionable(message, activeFile)
                : message,
            )
          : submittedMessages

      const compiledMessages = await Promise.all(
        messagesWithCurrentFile.map(async (message) => {
          if (message.role === 'user' && message.id === lastMessage.id) {
            const { promptContent, similaritySearchResults } =
              await promptGenerator.compileUserMessagePrompt({
                message,
                useVaultSearch: mode === 'vault',
                onQueryProgressChange: (progress) => {
                  if (isCurrentWork(generation, conversationId)) {
                    setQueryProgress(progress)
                  }
                },
              })
            return {
              ...message,
              promptContent,
              similaritySearchResults,
            }
          } else if (message.role === 'user' && !message.promptContent) {
            // Ensure all user messages have prompt content
            // This is a fallback for cases where compilation was missed earlier in the process
            const { promptContent, similaritySearchResults } =
              await promptGenerator.compileUserMessagePrompt({
                message,
              })
            return {
              ...message,
              promptContent,
              similaritySearchResults,
            }
          }
          return message
        }),
      )

      if (!isCurrentWork(generation, conversationId)) return
      setChatMessages(compiledMessages)
      if (mode === 'agent') {
        const toolDispatcher = await getToolDispatcher()
        if (!isCurrentWork(generation, conversationId)) return
        const compiledLastMessage = compiledMessages.at(-1)
        if (compiledLastMessage?.role !== 'user') {
          throw new Error('Last compiled message is not a user message')
        }
        const agentPrompt =
          typeof compiledLastMessage.promptContent === 'string'
            ? compiledLastMessage.promptContent
            : compiledLastMessage.content
              ? editorStateToPlainText(compiledLastMessage.content)
              : ''
        const toolCallId = uuidv4()
        const abortController = new AbortController()
        registerActiveAgentToolCall(toolCallId, abortController)
        const agentTask = (async () => {
          try {
            const response = await toolDispatcher.callTool({
              name: CODEX_TOOL_NAME,
              args: buildAgentChatRequestArgs(
                buildAgentPrompt({
                  messages: compiledMessages,
                  prompt: agentPrompt,
                  userMessage: compiledLastMessage,
                }),
              ),
              id: toolCallId,
              onEvent: (event) => {
                if (!isCurrentWork(generation, conversationId)) return
                const commandMessage = buildAgentCommandMessageFromEvent(event)
                if (!commandMessage) {
                  return
                }
                setChatMessages((prevMessages) =>
                  upsertAgentCommandMessage(prevMessages, commandMessage),
                )
              },
              signal: abortController.signal,
            })
            if (!isCurrentWork(generation, conversationId)) return
            const content =
              response.status === ToolCallResponseStatus.Success
                ? response.data.text
                : response.status === ToolCallResponseStatus.Aborted
                  ? 'Agent Chat was stopped.'
                  : response.status === ToolCallResponseStatus.Error
                    ? response.error
                    : `Agent Chat ended with status: ${response.status}`
            setChatMessages((prevMessages) => [
              ...prevMessages,
              buildAgentAssistantMessage(content),
            ])
          } catch (error) {
            if (!isCurrentWork(generation, conversationId)) return
            setChatMessages((prevMessages) => [
              ...prevMessages,
              buildAgentAssistantMessage(
                redactSecrets(
                  error instanceof Error ? error.message : String(error),
                ),
              ),
            ])
          } finally {
            unregisterActiveAgentToolCall(toolCallId)
          }
        })()
        activeAgentTasksRef.current.add(agentTask)
        try {
          await agentTask
        } finally {
          activeAgentTasksRef.current.delete(agentTask)
        }
        return
      }
      if (!isCurrentWork(generation, conversationId)) return
      submitChatMutation.mutate({
        chatMessages: compiledMessages,
        conversationId,
      })
    },
    [
      submitChatMutation,
      promptGenerator,
      getToolDispatcher,
      invalidateActiveWork,
      isCurrentWork,
      app.workspace,
      forceScrollToBottom,
      registerActiveAgentToolCall,
      unregisterActiveAgentToolCall,
    ],
  )

  const applyMutation = useMutation({
    mutationFn: async ({
      blockToApply,
      chatMessages,
    }: {
      blockToApply: string
      chatMessages: ChatMessage[]
    }) => {
      const activeFile = app.workspace.getActiveFile()
      if (!activeFile) {
        throw new Error(
          'No file is currently open to apply changes. Please open a file and try again.',
        )
      }
      const activeFileContent = await readTFileContent(activeFile, app.vault)

      const { providerClient, model } = getChatModelClient({
        modelId: settings.applyModelId,
        settings,
        setSettings,
        getSettings,
      })

      const updatedFileContent = await applyChangesToFile({
        blockToApply,
        currentFile: activeFile,
        currentFileContent: activeFileContent,
        chatMessages,
        providerClient,
        model,
      })
      if (!updatedFileContent) {
        throw new Error('Failed to apply changes')
      }

      await app.workspace.getLeaf(true).setViewState({
        type: APPLY_VIEW_TYPE,
        active: true,
        state: {
          file: activeFile,
          originalContent: activeFileContent,
          newContent: updatedFileContent,
        } satisfies ApplyViewState,
      })
    },
    onError: (error) => {
      if (
        error instanceof LLMAPIKeyNotSetException ||
        error instanceof LLMAPIKeyInvalidException ||
        error instanceof LLMBaseUrlNotSetException
      ) {
        new ErrorModal(app, 'Error', error.message, error.rawError?.message, {
          showSettingsButton: true,
        }).open()
      } else {
        new Notice(redactSecrets(error.message))
        console.error('Failed to apply changes', redactSecrets(error))
      }
    },
  })

  const handleApply = useCallback(
    (blockToApply: string, chatMessages: ChatMessage[]) => {
      applyMutation.mutate({ blockToApply, chatMessages })
    },
    [applyMutation],
  )

  const abortToolCall = useCallback(
    (toolCallId: string, onlyIfActive = false) => {
      const activeToolCalls = activeApprovedToolCallsRef.current.filter(
        (toolCall) => toolCall.toolCallId === toolCallId,
      )
      if (onlyIfActive && activeToolCalls.length === 0) return
      activeToolCalls.forEach(({ abortController }) => abortController.abort())
      void getToolDispatcher()
        .then((toolDispatcher) => toolDispatcher.abortToolCall(toolCallId))
        .catch((error) => {
          console.error('Failed to abort tool call', redactSecrets(error))
        })
    },
    [getToolDispatcher],
  )

  const handleToolCallResponseUpdate = useCallback(
    (
      conversationId: string,
      generation: number,
      messageId: string,
      toolCallId: string,
      response: ToolCallResponse,
    ) => {
      if (!isCurrentWork(generation, conversationId)) {
        abortToolCall(toolCallId)
        return
      }

      const messages = latestChatMessagesRef.current
      const toolMessageIndex = messages.findIndex(
        (message) => message.id === messageId,
      )
      const currentToolMessage = messages[toolMessageIndex]
      if (!currentToolMessage || currentToolMessage.role !== 'tool') {
        abortToolCall(toolCallId)
        return
      }

      const updatedToolMessage: ChatToolMessage = {
        ...currentToolMessage,
        toolCalls: currentToolMessage.toolCalls.map((toolCall) =>
          toolCall.request.id === toolCallId
            ? { ...toolCall, response }
            : toolCall,
        ),
      }
      const updatedMessages = messages.map((message) =>
        message.id === messageId ? updatedToolMessage : message,
      )
      latestChatMessagesRef.current = updatedMessages
      setChatMessages(updatedMessages)

      if (isAgentChatTerminalMessage(updatedToolMessage)) return

      if (
        toolMessageIndex === messages.length - 1 &&
        updatedToolMessage.toolCalls.every((toolCall) =>
          [
            ToolCallResponseStatus.Success,
            ToolCallResponseStatus.Error,
          ].includes(toolCall.response.status),
        )
      ) {
        submitChatMutation.mutate({
          chatMessages: updatedMessages,
          conversationId,
        })
        requestAnimationFrame(() => {
          forceScrollToBottom()
        })
      }
    },
    [abortToolCall, forceScrollToBottom, isCurrentWork, submitChatMutation],
  )

  const showContinueResponseButton = useMemo(() => {
    /**
     * Display the button to continue response when:
     * 1. There is no ongoing generation
     * 2. The most recent message is a tool message
     * 3. All tool calls within that message have completed
     */

    if (submitChatMutation.isPending) return false

    const lastMessage = chatMessages.at(-1)
    if (lastMessage && isAgentChatTerminalMessage(lastMessage)) {
      return false
    }
    if (lastMessage?.role !== 'tool') return false

    return lastMessage.toolCalls.every((toolCall) =>
      [
        ToolCallResponseStatus.Aborted,
        ToolCallResponseStatus.Rejected,
        ToolCallResponseStatus.Error,
        ToolCallResponseStatus.Success,
      ].includes(toolCall.response.status),
    )
  }, [submitChatMutation.isPending, chatMessages])

  const handleContinueResponse = useCallback(() => {
    submitChatMutation.mutate({
      chatMessages: chatMessages,
      conversationId: currentConversationId,
    })
  }, [submitChatMutation, chatMessages, currentConversationId])

  useEffect(() => {
    setFocusedMessageId(inputMessage.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (chatMessages.length > 0) {
      createOrUpdateConversation(currentConversationId, chatMessages)
    }
  }, [currentConversationId, chatMessages, createOrUpdateConversation])

  // Updates the currentFile of the focused message (input or chat history)
  // This happens when active file changes or focused message changes
  const handleActiveLeafChange = useCallback(() => {
    const activeFile = app.workspace.getActiveFile()
    if (!activeFile) return

    const mentionable: Omit<MentionableCurrentFile, 'id'> = {
      type: 'current-file',
      file: activeFile,
    }

    if (!focusedMessageId) return
    if (inputMessage.id === focusedMessageId) {
      setInputMessage((prevInputMessage) => ({
        ...prevInputMessage,
        mentionables: [
          mentionable,
          ...prevInputMessage.mentionables.filter(
            (mentionable) => mentionable.type !== 'current-file',
          ),
        ],
      }))
    } else {
      setChatMessages((prevChatHistory) =>
        prevChatHistory.map((message) =>
          message.id === focusedMessageId && message.role === 'user'
            ? {
                ...message,
                mentionables: [
                  mentionable,
                  ...message.mentionables.filter(
                    (mentionable) => mentionable.type !== 'current-file',
                  ),
                ],
              }
            : message,
        ),
      )
    }
  }, [app.workspace, focusedMessageId, inputMessage.id])

  useEffect(() => {
    app.workspace.on('active-leaf-change', handleActiveLeafChange)
    return () => {
      app.workspace.off('active-leaf-change', handleActiveLeafChange)
    }
  }, [app.workspace, handleActiveLeafChange])

  useImperativeHandle(ref, () => ({
    abortActiveWork,
    flushPendingSave,
    openNewChat: (selectedBlock?: MentionableBlockData) => {
      handleNewChat(selectedBlock)
    },
    addSelectionToChat: (selectedBlock: MentionableBlockData) => {
      const mentionable: Omit<MentionableBlock, 'id'> = {
        type: 'block',
        ...selectedBlock,
      }

      setAddedBlockKey(getMentionableKey(serializeMentionable(mentionable)))

      if (focusedMessageId === inputMessage.id) {
        setInputMessage((prevInputMessage) => {
          const mentionableKey = getMentionableKey(
            serializeMentionable(mentionable),
          )
          // Check if mentionable already exists
          if (
            prevInputMessage.mentionables.some(
              (m) =>
                getMentionableKey(serializeMentionable(m)) === mentionableKey,
            )
          ) {
            return prevInputMessage
          }
          return {
            ...prevInputMessage,
            mentionables: [...prevInputMessage.mentionables, mentionable],
          }
        })
      } else {
        setChatMessages((prevChatHistory) =>
          prevChatHistory.map((message) => {
            if (message.id === focusedMessageId && message.role === 'user') {
              const mentionableKey = getMentionableKey(
                serializeMentionable(mentionable),
              )
              // Check if mentionable already exists
              if (
                message.mentionables.some(
                  (m) =>
                    getMentionableKey(serializeMentionable(m)) ===
                    mentionableKey,
                )
              ) {
                return message
              }
              return {
                ...message,
                mentionables: [...message.mentionables, mentionable],
              }
            }
            return message
          }),
        )
      }
    },
    focusMessage: () => {
      if (!focusedMessageId) return
      chatUserInputRefs.current.get(focusedMessageId)?.focus()
    },
  }))

  const renderedWorkGeneration = workGenerationRef.current

  return (
    <div className="smtcmp-chat-container">
      <div className="smtcmp-chat-header">
        <div className="smtcmp-chat-header-title">Chat</div>
        <div className="smtcmp-chat-header-buttons">
          <button
            onClick={() => handleNewChat()}
            className="clickable-icon"
            aria-label="New Chat"
          >
            <Plus size={18} />
          </button>
          <ChatListDropdown
            chatList={chatList}
            currentConversationId={currentConversationId}
            onSelect={async (conversationId) => {
              if (conversationId === currentConversationId) return
              await handleLoadConversation(conversationId)
            }}
            onDelete={async (conversationId) => {
              await deleteConversation(conversationId)
              if (conversationId === currentConversationId) {
                const nextConversation = chatList.find(
                  (chat) => chat.id !== conversationId,
                )
                if (nextConversation) {
                  void handleLoadConversation(nextConversation.id)
                } else {
                  handleNewChat()
                }
              }
            }}
            onUpdateTitle={async (conversationId, newTitle) => {
              await updateConversationTitle(conversationId, newTitle)
            }}
          >
            <History size={18} />
          </ChatListDropdown>
          <button
            onClick={() => {
              new TemplateSectionModal(app).open()
            }}
            className="clickable-icon"
            aria-label="Prompt Templates"
          >
            <Book size={18} />
          </button>
        </div>
      </div>
      <>
        <div className="smtcmp-chat-messages" ref={chatMessagesRef}>
          {chatMessageRows.map(({ messageOrGroup, endIndex }) =>
            !Array.isArray(messageOrGroup) ? (
              <UserMessageItem
                key={messageOrGroup.id}
                message={messageOrGroup}
                chatUserInputRef={(ref) =>
                  registerChatUserInputRef(messageOrGroup.id, ref)
                }
                onInputChange={(content) => {
                  setChatMessages((prevChatHistory) =>
                    prevChatHistory.map((msg) =>
                      msg.role === 'user' && msg.id === messageOrGroup.id
                        ? {
                            ...msg,
                            content,
                          }
                        : msg,
                    ),
                  )
                }}
                onSubmit={(content, mode) => {
                  if (editorStateToPlainText(content).trim() === '') return
                  handleUserMessageSubmit({
                    inputChatMessages: [
                      ...chatMessages.slice(0, endIndex - 1),
                      {
                        role: 'user',
                        content: content,
                        promptContent: null,
                        id: messageOrGroup.id,
                        mentionables: messageOrGroup.mentionables,
                      },
                    ],
                    mode,
                  })
                  chatUserInputRefs.current.get(inputMessage.id)?.focus()
                }}
                onFocus={() => {
                  setFocusedMessageId(messageOrGroup.id)
                }}
                onMentionablesChange={(mentionables) => {
                  setChatMessages((prevChatHistory) =>
                    prevChatHistory.map((msg) =>
                      msg.id === messageOrGroup.id
                        ? { ...msg, mentionables }
                        : msg,
                    ),
                  )
                }}
              />
            ) : (
              <AssistantToolMessageGroupItem
                key={messageOrGroup.at(0)?.id}
                messages={messageOrGroup}
                getContextMessages={() => chatMessages.slice(0, endIndex)}
                conversationId={currentConversationId}
                isApplying={applyMutation.isPending}
                onApply={handleApply}
                executeToolCall={(request, onResponseUpdate) =>
                  executeApprovedToolCall(
                    request,
                    currentConversationId,
                    renderedWorkGeneration,
                    onResponseUpdate,
                  )
                }
                abortToolCall={abortToolCall}
                onToolCallResponseUpdate={(messageId, toolCallId, response) =>
                  handleToolCallResponseUpdate(
                    currentConversationId,
                    renderedWorkGeneration,
                    messageId,
                    toolCallId,
                    response,
                  )
                }
              />
            ),
          )}
          <QueryProgress state={queryProgress} />
          {showContinueResponseButton && (
            <div className="smtcmp-continue-response-button-container">
              <button
                className="smtcmp-continue-response-button"
                onClick={handleContinueResponse}
              >
                <div>Continue Response</div>
              </button>
            </div>
          )}
          {(submitChatMutation.isPending || activeAgentToolCallCount > 0) && (
            <button onClick={abortActiveWork} className="smtcmp-stop-gen-btn">
              <CircleStop size={16} />
              <div>Stop Generation</div>
            </button>
          )}
        </div>
        <ChatUserInput
          key={inputMessage.id} // this is needed to clear the editor when the user submits a new message
          ref={(ref) => registerChatUserInputRef(inputMessage.id, ref)}
          initialSerializedEditorState={inputMessage.content}
          onChange={(content) => {
            setInputMessage((prevInputMessage) => ({
              ...prevInputMessage,
              content,
            }))
          }}
          onSubmit={(content, mode) => {
            if (editorStateToPlainText(content).trim() === '') return
            handleUserMessageSubmit({
              inputChatMessages: [
                ...chatMessages,
                { ...inputMessage, content },
              ],
              mode,
            })
            setInputMessage(getNewInputMessage(app))
          }}
          onFocus={() => {
            setFocusedMessageId(inputMessage.id)
          }}
          mentionables={inputMessage.mentionables}
          setMentionables={(mentionables) => {
            setInputMessage((prevInputMessage) => ({
              ...prevInputMessage,
              mentionables,
            }))
          }}
          autoFocus
          addedBlockKey={addedBlockKey}
        />
      </>
    </div>
  )
})

Chat.displayName = 'Chat'

export default Chat
