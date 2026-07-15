import { useQuery } from '@tanstack/react-query'
import { $nodesOfType, LexicalEditor, SerializedEditorState } from 'lexical'
import { X } from 'lucide-react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'

import { useApp } from '../../../contexts/app-context'
import {
  MAX_MENTIONABLE_IMAGES,
  MAX_MENTIONABLE_IMAGE_TOTAL_DATA_CHARS,
  Mentionable,
  MentionableCurrentFile,
  MentionableImage,
  SerializedMentionable,
} from '../../../types/mentionable'
import {
  deserializeMentionable,
  getMentionableKey,
  serializeMentionable,
} from '../../../utils/chat/mentionable'
import { filesToMentionableImages } from '../../../utils/llm/image'
import { openMarkdownFile, readTFileContent } from '../../../utils/obsidian'
import { ObsidianMarkdown } from '../ObsidianMarkdown'

import { AgentChatButton } from './AgentChatButton'
import { ImageUploadButton } from './ImageUploadButton'
import LexicalContentEditable from './LexicalContentEditable'
import MentionableBadge from './MentionableBadge'
import { ModelSelect } from './ModelSelect'
import { MentionNode } from './plugins/mention/MentionNode'
import { NodeMutations } from './plugins/on-mutation/OnMutationPlugin'
import { SubmitButton } from './SubmitButton'
import ToolBadge from './ToolBadge'
import { hasSubmittableContent } from './utils/editor-state-to-plain-text'
import { VaultChatButton } from './VaultChatButton'

export type ChatUserInputRef = {
  focus: () => void
  addMentionable: (mentionable: Mentionable) => void
  setCurrentFile: (file: MentionableCurrentFile['file']) => void
}

export type ChatSubmitMode = 'chat' | 'vault' | 'agent'

export type ChatUserInputProps = {
  initialSerializedEditorState: SerializedEditorState | null
  onChange: (content: SerializedEditorState) => void
  onSubmit: (content: SerializedEditorState, mode?: ChatSubmitMode) => void
  onFocus: () => void
  mentionables: Mentionable[]
  setMentionables: (mentionables: Mentionable[]) => void
  autoFocus?: boolean
  addedBlockKey?: string | null
  isWorking?: boolean
  onStop?: () => void
  onDone?: () => void
}

const ChatUserInput = forwardRef<ChatUserInputRef, ChatUserInputProps>(
  (
    {
      initialSerializedEditorState,
      onChange,
      onSubmit,
      onFocus,
      mentionables,
      setMentionables,
      autoFocus = false,
      addedBlockKey,
      isWorking = false,
      onStop,
      onDone,
    },
    ref,
  ) => {
    const app = useApp()

    const editorRef = useRef<LexicalEditor | null>(null)
    const contentEditableRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    const [displayedMentionableKey, setDisplayedMentionableKey] = useState<
      string | null
    >(addedBlockKey ?? null)

    useEffect(() => {
      if (addedBlockKey) setDisplayedMentionableKey(addedBlockKey)
    }, [addedBlockKey])

    const addMentionable = useCallback(
      (mentionable: Mentionable) => {
        const mentionableKey = getMentionableKey(
          serializeMentionable(mentionable),
        )
        if (
          !mentionables.some(
            (item) =>
              getMentionableKey(serializeMentionable(item)) === mentionableKey,
          )
        ) {
          setMentionables([...mentionables, mentionable])
        }
        setDisplayedMentionableKey(mentionableKey)
      },
      [mentionables, setMentionables],
    )

    const setCurrentFile = useCallback(
      (file: MentionableCurrentFile['file']) => {
        setMentionables([
          { type: 'current-file', file },
          ...mentionables.filter(
            (mentionable) => mentionable.type !== 'current-file',
          ),
        ])
      },
      [mentionables, setMentionables],
    )

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          contentEditableRef.current?.focus()
        },
        addMentionable,
        setCurrentFile,
      }),
      [addMentionable, setCurrentFile],
    )

    const handleMentionNodeMutation = (
      mutations: NodeMutations<MentionNode>,
    ) => {
      const destroyedMentionableKeys: string[] = []
      const addedMentionables: SerializedMentionable[] = []
      mutations.forEach((mutation) => {
        const mentionable = mutation.node.getMentionable()
        const mentionableKey = getMentionableKey(mentionable)

        if (mutation.mutation === 'destroyed') {
          const nodeWithSameMentionable = editorRef.current?.read(() =>
            $nodesOfType(MentionNode).find(
              (node) =>
                getMentionableKey(node.getMentionable()) === mentionableKey,
            ),
          )

          if (!nodeWithSameMentionable) {
            // remove mentionable only if it's not present in the editor state
            destroyedMentionableKeys.push(mentionableKey)
          }
        } else if (mutation.mutation === 'created') {
          if (
            mentionables.some(
              (m) =>
                getMentionableKey(serializeMentionable(m)) === mentionableKey,
            ) ||
            addedMentionables.some(
              (m) => getMentionableKey(m) === mentionableKey,
            )
          ) {
            // do nothing if mentionable is already added
            return
          }

          addedMentionables.push(mentionable)
        }
      })

      setMentionables(
        mentionables
          .filter(
            (m) =>
              !destroyedMentionableKeys.includes(
                getMentionableKey(serializeMentionable(m)),
              ),
          )
          .concat(
            addedMentionables
              .map((m) => deserializeMentionable(m, app))
              .filter((v) => !!v),
          ),
      )
      if (addedMentionables.length > 0) {
        setDisplayedMentionableKey(
          getMentionableKey(addedMentionables[addedMentionables.length - 1]),
        )
      }
    }

    const handleCreateImageMentionables = useCallback(
      (mentionableImages: MentionableImage[]) => {
        const remainingImageSlots = Math.max(
          0,
          MAX_MENTIONABLE_IMAGES -
            mentionables.filter((mentionable) => mentionable.type === 'image')
              .length,
        )
        let remainingImageChars =
          MAX_MENTIONABLE_IMAGE_TOTAL_DATA_CHARS -
          mentionables.reduce(
            (total, mentionable) =>
              total +
              (mentionable.type === 'image' ? mentionable.data.length : 0),
            0,
          )
        const newMentionableImages = mentionableImages
          .filter(
            (m) =>
              !mentionables.some(
                (mentionable) =>
                  getMentionableKey(serializeMentionable(mentionable)) ===
                  getMentionableKey(serializeMentionable(m)),
              ),
          )
          .slice(0, remainingImageSlots)
          .filter((image) => {
            if (image.data.length > remainingImageChars) return false
            remainingImageChars -= image.data.length
            return true
          })
        if (newMentionableImages.length === 0) return
        setMentionables([...mentionables, ...newMentionableImages])
        const lastImage = newMentionableImages.at(-1)
        if (lastImage) {
          setDisplayedMentionableKey(
            getMentionableKey(serializeMentionable(lastImage)),
          )
        }
      },
      [mentionables, setMentionables],
    )

    const handleMentionableDelete = (mentionable: Mentionable) => {
      const mentionableKey = getMentionableKey(
        serializeMentionable(mentionable),
      )
      setMentionables(
        mentionables.filter(
          (m) => getMentionableKey(serializeMentionable(m)) !== mentionableKey,
        ),
      )
      if (displayedMentionableKey === mentionableKey) {
        setDisplayedMentionableKey(null)
      }

      editorRef.current?.update(() => {
        $nodesOfType(MentionNode).forEach((node) => {
          if (getMentionableKey(node.getMentionable()) === mentionableKey) {
            node.remove()
          }
        })
      })
    }

    const handleUploadImages = async (images: File[]) => {
      const mentionableImages = await filesToMentionableImages(
        images.slice(0, MAX_MENTIONABLE_IMAGES),
      )
      handleCreateImageMentionables(mentionableImages)
    }

    const handleSubmit = (mode: ChatSubmitMode = 'chat') => {
      if (isWorking) return
      const content = editorRef.current?.getEditorState()?.toJSON()
      if (!content || !hasSubmittableContent(content, mentionables)) return
      onSubmit(content, mode)
    }

    return (
      <div className="smtcmp-chat-user-input-container" ref={containerRef}>
        <div className="smtcmp-chat-user-input-files">
          <ToolBadge />
          {mentionables.map((m) => (
            <MentionableBadge
              key={getMentionableKey(serializeMentionable(m))}
              mentionable={m}
              onDelete={() => handleMentionableDelete(m)}
              onClick={() => {
                const mentionableKey = getMentionableKey(
                  serializeMentionable(m),
                )
                if (
                  mentionableKey === displayedMentionableKey &&
                  (m.type === 'current-file' ||
                    m.type === 'file' ||
                    m.type === 'block') &&
                  m.file
                ) {
                  openMarkdownFile(
                    app,
                    m.file.path,
                    m.type === 'block' ? m.startLine : undefined,
                  )
                } else {
                  setDisplayedMentionableKey(mentionableKey)
                }
              }}
              isFocused={
                getMentionableKey(serializeMentionable(m)) ===
                displayedMentionableKey
              }
            />
          ))}
        </div>

        <MentionableContentPreview
          displayedMentionableKey={displayedMentionableKey}
          mentionables={mentionables}
          onClose={() => setDisplayedMentionableKey(null)}
        />

        <LexicalContentEditable
          initialEditorState={(editor) => {
            if (initialSerializedEditorState) {
              editor.setEditorState(
                editor.parseEditorState(initialSerializedEditorState),
              )
            }
          }}
          editorRef={editorRef}
          contentEditableRef={contentEditableRef}
          onChange={onChange}
          onEnter={() => handleSubmit()}
          onFocus={onFocus}
          onMentionNodeMutation={handleMentionNodeMutation}
          onCreateImageMentionables={handleCreateImageMentionables}
          autoFocus={autoFocus}
          placeholder="Message Aider · @ for context · / for templates"
          plugins={{
            onEnter: {
              onAgentChat: () => handleSubmit('agent'),
              onVaultChat: () => handleSubmit('vault'),
            },
            templatePopover: {
              anchorElement: containerRef.current,
            },
          }}
        />

        <div className="smtcmp-chat-user-input-controls">
          <div className="smtcmp-chat-user-input-controls__model-select-container">
            <ModelSelect />
          </div>
          <div className="smtcmp-chat-user-input-controls__buttons">
            <ImageUploadButton onUpload={handleUploadImages} />
            {onDone && (
              <button
                type="button"
                className="smtcmp-chat-edit-cancel-button"
                onClick={onDone}
              >
                Cancel
              </button>
            )}
            {!isWorking && (
              <>
                <VaultChatButton onClick={() => handleSubmit('vault')} />
                <AgentChatButton onClick={() => handleSubmit('agent')} />
              </>
            )}
            <SubmitButton
              onClick={() => handleSubmit()}
              isWorking={isWorking}
              onStop={onStop}
            />
          </div>
        </div>
      </div>
    )
  },
)

function MentionableContentPreview({
  displayedMentionableKey,
  mentionables,
  onClose,
}: {
  displayedMentionableKey: string | null
  mentionables: Mentionable[]
  onClose: () => void
}) {
  const app = useApp()

  const displayedMentionable: Mentionable | null = useMemo(() => {
    return (
      mentionables.find(
        (m) =>
          getMentionableKey(serializeMentionable(m)) ===
          displayedMentionableKey,
      ) ?? null
    )
  }, [displayedMentionableKey, mentionables])

  const { data: displayFileContent } = useQuery({
    enabled:
      !!displayedMentionable &&
      ['file', 'current-file', 'block'].includes(displayedMentionable.type),
    queryKey: [
      'file',
      displayedMentionableKey,
      mentionables.map((m) => getMentionableKey(serializeMentionable(m))), // should be updated when mentionables change (especially on delete)
    ],
    queryFn: async () => {
      if (!displayedMentionable) return null
      if (
        displayedMentionable.type === 'file' ||
        displayedMentionable.type === 'current-file'
      ) {
        if (!displayedMentionable.file) return null
        return await readTFileContent(displayedMentionable.file, app.vault)
      } else if (displayedMentionable.type === 'block') {
        const fileContent = await readTFileContent(
          displayedMentionable.file,
          app.vault,
        )

        return fileContent
          .split('\n')
          .slice(
            displayedMentionable.startLine - 1,
            displayedMentionable.endLine,
          )
          .join('\n')
      }

      return null
    },
  })

  const displayImage: MentionableImage | null = useMemo(() => {
    return displayedMentionable?.type === 'image' ? displayedMentionable : null
  }, [displayedMentionable])

  if (!displayFileContent && !displayImage) return null

  return (
    <div className="smtcmp-chat-user-input-file-content-preview">
      <button
        type="button"
        className="clickable-icon smtcmp-context-preview-close"
        aria-label="Close context preview"
        onClick={onClose}
      >
        <X size={14} />
      </button>
      {displayFileContent ? (
        <ObsidianMarkdown content={displayFileContent} scale="xs" />
      ) : (
        displayImage && <img src={displayImage.data} alt={displayImage.name} />
      )}
    </div>
  )
}

ChatUserInput.displayName = 'ChatUserInput'

export default ChatUserInput
