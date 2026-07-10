import { UseMutationResult, useMutation } from '@tanstack/react-query'
import { Notice } from 'obsidian'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { useApp } from '../../contexts/app-context'
import { useSettings } from '../../contexts/settings-context'
import { useToolDispatcher } from '../../contexts/tool-dispatcher-context'
import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
  LLMBaseUrlNotSetException,
  LLMModelNotFoundException,
} from '../../core/llm/exception'
import { getChatModelClient } from '../../core/llm/manager'
import { ChatMessage } from '../../types/chat'
import { PromptGenerator } from '../../utils/chat/promptGenerator'
import { ResponseGenerator } from '../../utils/chat/responseGenerator'
import { redactSecrets } from '../../utils/security/redact-secrets'
import { ErrorModal } from '../modals/ErrorModal'

type UseChatStreamManagerParams = {
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
  autoScrollToBottom: () => void
  promptGenerator: PromptGenerator
}

export type UseChatStreamManager = {
  abortActiveStreams: () => Promise<void>
  submitChatMutation: UseMutationResult<
    void,
    Error,
    { chatMessages: ChatMessage[]; conversationId: string }
  >
}

export function useChatStreamManager({
  setChatMessages,
  autoScrollToBottom,
  promptGenerator,
}: UseChatStreamManagerParams): UseChatStreamManager {
  const app = useApp()
  const { settings, setSettings, getSettings } = useSettings()
  const { getToolDispatcher } = useToolDispatcher()

  const activeStreamAbortControllersRef = useRef<AbortController[]>([])
  const activeStreamTasksRef = useRef(new Set<Promise<void>>())
  const streamGenerationRef = useRef(0)

  const invalidateActiveStreams = useCallback(() => {
    const generation = ++streamGenerationRef.current
    for (const abortController of activeStreamAbortControllersRef.current) {
      abortController.abort()
    }
    activeStreamAbortControllersRef.current = []
    return {
      generation,
      tasks: [...activeStreamTasksRef.current],
    }
  }, [])

  const abortActiveStreams = useCallback(async () => {
    const { tasks } = invalidateActiveStreams()
    await Promise.all(tasks.map((task) => task.catch(() => undefined)))
  }, [invalidateActiveStreams])

  useEffect(() => {
    return () => {
      void abortActiveStreams()
    }
  }, [abortActiveStreams])

  const { providerClient, model } = useMemo(() => {
    try {
      return getChatModelClient({
        modelId: settings.chatModelId,
        settings,
        setSettings,
        getSettings,
      })
    } catch (error) {
      if (error instanceof LLMModelNotFoundException) {
        if (settings.chatModels.length === 0) {
          throw error
        }
        // Fallback to the first chat model if the selected chat model is not found
        const firstChatModel = settings.chatModels[0]
        setSettings({
          ...settings,
          chatModelId: firstChatModel.id,
          chatModels: settings.chatModels.map((model) =>
            model.id === firstChatModel.id
              ? {
                  ...model,
                  enable: true,
                }
              : model,
          ),
        })
        return getChatModelClient({
          modelId: firstChatModel.id,
          settings,
          setSettings,
          getSettings,
        })
      }
      throw error
    }
  }, [settings, setSettings, getSettings])

  const submitChatMutation = useMutation({
    mutationFn: async ({
      chatMessages,
      conversationId,
    }: {
      chatMessages: ChatMessage[]
      conversationId: string
    }) => {
      const lastMessage = chatMessages.at(-1)
      if (!lastMessage) {
        // chatMessages is empty
        return
      }

      const { generation } = invalidateActiveStreams()
      if (generation !== streamGenerationRef.current) return

      const abortController = new AbortController()
      activeStreamAbortControllersRef.current.push(abortController)

      let unsubscribeResponseGenerator: (() => void) | undefined

      try {
        const toolDispatcher = await getToolDispatcher()
        if (
          abortController.signal.aborted ||
          generation !== streamGenerationRef.current
        ) {
          return
        }
        const responseGenerator = new ResponseGenerator({
          providerClient,
          model,
          messages: chatMessages,
          conversationId,
          enableTools: settings.chatOptions.enableTools,
          maxAutoIterations: settings.chatOptions.maxAutoIterations,
          promptGenerator,
          toolDispatcher,
          abortSignal: abortController.signal,
        })

        unsubscribeResponseGenerator = responseGenerator.subscribe(
          (responseMessages) => {
            if (generation !== streamGenerationRef.current) return
            setChatMessages((prevChatMessages) => {
              const lastMessageIndex = prevChatMessages.findIndex(
                (message) => message.id === lastMessage.id,
              )
              if (lastMessageIndex === -1) {
                // The last message no longer exists in the chat history.
                // This likely means a new message was submitted while this stream was running.
                // Abort this stream and keep the current chat history.
                abortController.abort()
                return prevChatMessages
              }
              return [
                ...prevChatMessages.slice(0, lastMessageIndex + 1),
                ...responseMessages,
              ]
            })
            autoScrollToBottom()
          },
        )

        const streamTask = responseGenerator.run()
        activeStreamTasksRef.current.add(streamTask)
        try {
          await streamTask
        } finally {
          activeStreamTasksRef.current.delete(streamTask)
        }
      } catch (error) {
        if (generation !== streamGenerationRef.current) return
        // Ignore AbortError
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
        throw error
      } finally {
        if (unsubscribeResponseGenerator) {
          unsubscribeResponseGenerator()
        }
        activeStreamAbortControllersRef.current =
          activeStreamAbortControllersRef.current.filter(
            (controller) => controller !== abortController,
          )
      }
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
        console.error('Failed to generate response', redactSecrets(error))
      }
    },
  })

  return {
    abortActiveStreams,
    submitChatMutation,
  }
}
