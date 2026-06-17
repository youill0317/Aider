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
import {
  AssistantToolMessageGroup,
  ChatMessage,
  ChatToolMessage,
  ChatUserMessage,
} from '../../types/chat'
import {
  MentionableBlock,
  MentionableBlockData,
  MentionableCurrentFile,
} from '../../types/mentionable'
import { ToolCallResponseStatus } from '../../types/tool-call.types'
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
import { groupAssistantAndToolMessages } from '../../utils/chat/message-groups'
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

export type ChatRef = {
  openNewChat: (selectedBlock?: MentionableBlockData) => void
  addSelectionToChat: (selectedBlock: MentionableBlockData) => void
  focusMessage: () => void
}

export type ChatProps = {
  selectedBlock?: MentionableBlockData
}

type ActiveAgentToolCall = {
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

  const groupedChatMessages: (ChatUserMessage | AssistantToolMessageGroup)[] =
    useMemo(() => {
      return groupAssistantAndToolMessages(chatMessages)
    }, [chatMessages])

  const chatUserInputRefs = useRef<Map<string, ChatUserInputRef>>(new Map())
  const chatMessagesRef = useRef<HTMLDivElement>(null)
  const activeAgentToolCallsRef = useRef<ActiveAgentToolCall[]>([])

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
    (messages: readonly ChatMessage[]) => {
      const activeToolCalls = activeAgentToolCallsRef.current
      const toolCallIds = new Set([
        ...activeToolCalls.map((toolCall) => toolCall.toolCallId),
        ...getRunningAgentChatToolCallIds(messages),
      ])

      activeAgentToolCallsRef.current = []
      setActiveAgentToolCallCount(0)
      activeToolCalls.forEach(({ abortController }) => {
        abortController.abort()
      })
      if (toolCallIds.size === 0) {
        return
      }

      void (async () => {
        const toolDispatcher = await getToolDispatcher()
        toolCallIds.forEach((toolCallId) => {
          toolDispatcher.abortToolCall(toolCallId)
        })
      })().catch((error) => {
        console.error(
          'Failed to abort Agent Chat tool calls',
          redactSecrets(error),
        )
      })
    },
    [getToolDispatcher],
  )

  const abortActiveWork = useCallback(() => {
    abortActiveStreams()
    abortActiveAgentToolCalls(chatMessages)
  }, [abortActiveStreams, abortActiveAgentToolCalls, chatMessages])

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
      abortActiveWork()
      const conversation = await getChatMessagesById(conversationId)
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
      abortActiveWork()
    },
    [abortActiveWork, app],
  )

  const handleUserMessageSubmit = useCallback(
    async ({
      inputChatMessages,
      mode,
    }: {
      inputChatMessages: ChatMessage[]
      mode?: ChatSubmitMode
    }) => {
      abortActiveWork()
      setQueryProgress({
        type: 'idle',
      })

      // Update the chat history to show the new user message
      setChatMessages(inputChatMessages)
      requestAnimationFrame(() => {
        forceScrollToBottom()
      })

      const lastMessage = inputChatMessages.at(-1)
      if (lastMessage?.role !== 'user') {
        throw new Error('Last message is not a user message')
      }
      const activeFile = app.workspace.getActiveFile()
      const messagesWithCurrentFile =
        mode === 'agent'
          ? inputChatMessages.map((message) =>
              message.id === lastMessage.id && message.role === 'user'
                ? withCurrentFileMentionable(message, activeFile)
                : message,
            )
          : inputChatMessages

      const compiledMessages = await Promise.all(
        messagesWithCurrentFile.map(async (message) => {
          if (message.role === 'user' && message.id === lastMessage.id) {
            const { promptContent, similaritySearchResults } =
              await promptGenerator.compileUserMessagePrompt({
                message,
                useVaultSearch: mode === 'vault',
                onQueryProgressChange: setQueryProgress,
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

      setChatMessages(compiledMessages)
      if (mode === 'agent') {
        const toolDispatcher = await getToolDispatcher()
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
        try {
          const response = await toolDispatcher.callTool({
            name: CODEX_TOOL_NAME,
            args: buildAgentChatRequestArgs(
              buildAgentPrompt({
                prompt: agentPrompt,
                userMessage: compiledLastMessage,
              }),
            ),
            id: toolCallId,
            onEvent: (event) => {
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
        return
      }
      submitChatMutation.mutate({
        chatMessages: compiledMessages,
        conversationId: currentConversationId,
      })
    },
    [
      submitChatMutation,
      currentConversationId,
      promptGenerator,
      getToolDispatcher,
      abortActiveWork,
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

  const handleToolMessageUpdate = useCallback(
    async (toolMessage: ChatToolMessage) => {
      const toolMessageIndex = chatMessages.findIndex(
        (message) => message.id === toolMessage.id,
      )
      if (toolMessageIndex === -1) {
        // The tool message no longer exists in the chat history.
        // This likely means a new message was submitted while this stream was running.
        // Abort the tool calls and keep the current chat history.
        void (async () => {
          const toolDispatcher = await getToolDispatcher()
          toolMessage.toolCalls.forEach((toolCall) => {
            toolDispatcher.abortToolCall(toolCall.request.id)
          })
        })()
        return
      }

      const updatedMessages = chatMessages.map((message) =>
        message.id === toolMessage.id ? toolMessage : message,
      )
      setChatMessages(updatedMessages)

      if (isAgentChatTerminalMessage(toolMessage)) {
        return
      }

      // Resume the chat automatically if this tool message is the last message
      // and all tool calls have completed.
      if (
        toolMessageIndex === chatMessages.length - 1 &&
        toolMessage.toolCalls.every((toolCall) =>
          [
            ToolCallResponseStatus.Success,
            ToolCallResponseStatus.Error,
          ].includes(toolCall.response.status),
        )
      ) {
        // Using updated toolMessage directly because chatMessages state
        // still contains the old values
        submitChatMutation.mutate({
          chatMessages: updatedMessages,
          conversationId: currentConversationId,
        })
        requestAnimationFrame(() => {
          forceScrollToBottom()
        })
      }
    },
    [
      chatMessages,
      currentConversationId,
      submitChatMutation,
      setChatMessages,
      getToolDispatcher,
      forceScrollToBottom,
    ],
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
    const updateConversationAsync = async () => {
      try {
        if (chatMessages.length > 0) {
          createOrUpdateConversation(currentConversationId, chatMessages)
        }
      } catch (error) {
        new Notice('Failed to save chat history')
        console.error('Failed to save chat history', error)
      }
    }
    updateConversationAsync()
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
          {groupedChatMessages.map((messageOrGroup, index) =>
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
                      ...groupedChatMessages
                        .slice(0, index)
                        .flatMap((messageOrGroup): ChatMessage[] =>
                          !Array.isArray(messageOrGroup)
                            ? [messageOrGroup]
                            : messageOrGroup,
                        ),
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
                contextMessages={groupedChatMessages
                  .slice(0, index + 1)
                  .flatMap((messageOrGroup): ChatMessage[] =>
                    !Array.isArray(messageOrGroup)
                      ? [messageOrGroup]
                      : messageOrGroup,
                  )}
                conversationId={currentConversationId}
                isApplying={applyMutation.isPending}
                onApply={handleApply}
                onToolMessageUpdate={handleToolMessageUpdate}
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
