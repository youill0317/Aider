import clsx from 'clsx'
import { Eye, EyeOff, X } from 'lucide-react'
import { PropsWithChildren, ReactNode, useCallback } from 'react'

import { useSettings } from '../../../contexts/settings-context'
import {
  Mentionable,
  MentionableBlock,
  MentionableCurrentFile,
  MentionableFile,
  MentionableFolder,
  MentionableImage,
  MentionableUrl,
  MentionableVault,
} from '../../../types/mentionable'
import { runAsyncAction } from '../../../utils/async-action'
import { getMentionableName } from '../../../utils/chat/mentionable'

import { getMentionableIcon } from './utils/get-metionable-icon'

function BadgeBase({
  children,
  onDelete,
  onClick,
  isFocused,
  trailingAction,
  label,
}: PropsWithChildren<{
  onDelete: () => void
  onClick: () => void
  isFocused: boolean
  trailingAction?: ReactNode
  label: string
}>) {
  return (
    <div
      className={`smtcmp-chat-user-input-file-badge ${isFocused ? 'smtcmp-chat-user-input-file-badge-focused' : ''}`}
    >
      <button
        type="button"
        className="smtcmp-chat-user-input-file-badge-main"
        aria-label={`Preview ${label}`}
        aria-pressed={isFocused}
        onClick={onClick}
      >
        {children}
      </button>
      {trailingAction}
      <button
        type="button"
        className="smtcmp-chat-user-input-file-badge-delete"
        aria-label={`Remove ${label}`}
        onClick={(evt) => {
          evt.stopPropagation()
          onDelete()
        }}
      >
        <X size={12} />
      </button>
    </div>
  )
}

function FileBadge({
  mentionable,
  onDelete,
  onClick,
  isFocused,
}: {
  mentionable: MentionableFile
  onDelete: () => void
  onClick: () => void
  isFocused: boolean
}) {
  const Icon = getMentionableIcon(mentionable)
  return (
    <BadgeBase
      onDelete={onDelete}
      onClick={onClick}
      isFocused={isFocused}
      label={getMentionableName(mentionable)}
    >
      <div className="smtcmp-chat-user-input-file-badge-name">
        {Icon && (
          <Icon
            size={12}
            className="smtcmp-chat-user-input-file-badge-name-icon"
          />
        )}
        <span>{mentionable.file.name}</span>
      </div>
    </BadgeBase>
  )
}

function FolderBadge({
  mentionable,
  onDelete,
  onClick,
  isFocused,
}: {
  mentionable: MentionableFolder
  onDelete: () => void
  onClick: () => void
  isFocused: boolean
}) {
  const Icon = getMentionableIcon(mentionable)
  return (
    <BadgeBase
      onDelete={onDelete}
      onClick={onClick}
      isFocused={isFocused}
      label={getMentionableName(mentionable)}
    >
      <div className="smtcmp-chat-user-input-file-badge-name">
        {Icon && (
          <Icon
            size={12}
            className="smtcmp-chat-user-input-file-badge-name-icon"
          />
        )}
        <span>{mentionable.folder.name}</span>
      </div>
    </BadgeBase>
  )
}

function VaultBadge({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  mentionable,
  onDelete,
  onClick,
  isFocused,
}: {
  mentionable: MentionableVault
  onDelete: () => void
  onClick: () => void
  isFocused: boolean
}) {
  const Icon = getMentionableIcon(mentionable)
  return (
    <BadgeBase
      onDelete={onDelete}
      onClick={onClick}
      isFocused={isFocused}
      label={getMentionableName(mentionable)}
    >
      <div className="smtcmp-chat-user-input-file-badge-name">
        {Icon && (
          <Icon
            size={12}
            className="smtcmp-chat-user-input-file-badge-name-icon"
          />
        )}
        <span>Vault</span>
      </div>
    </BadgeBase>
  )
}

function CurrentFileBadge({
  mentionable,
  onDelete,
  onClick,
  isFocused,
}: {
  mentionable: MentionableCurrentFile
  onDelete: () => void
  onClick: () => void
  isFocused: boolean
}) {
  const { settings, setSettings } = useSettings()

  const handleCurrentFileToggle = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation()
      runAsyncAction(() =>
        setSettings((currentSettings) => ({
          ...currentSettings,
          chatOptions: {
            ...currentSettings.chatOptions,
            includeCurrentFileContent:
              !currentSettings.chatOptions.includeCurrentFileContent,
          },
        })),
      )
    },
    [setSettings],
  )

  const Icon = getMentionableIcon(mentionable)
  return mentionable.file ? (
    <BadgeBase
      onDelete={onDelete}
      onClick={onClick}
      isFocused={isFocused}
      label={getMentionableName(mentionable)}
      trailingAction={
        <button
          type="button"
          className="smtcmp-chat-user-input-file-badge-eye"
          aria-label={
            settings.chatOptions.includeCurrentFileContent
              ? 'Exclude current file content'
              : 'Include current file content'
          }
          aria-pressed={settings.chatOptions.includeCurrentFileContent}
          onClick={handleCurrentFileToggle}
        >
          {settings.chatOptions.includeCurrentFileContent ? (
            <Eye size={12} />
          ) : (
            <EyeOff size={12} />
          )}
        </button>
      }
    >
      <div className="smtcmp-chat-user-input-file-badge-name">
        {Icon && (
          <Icon
            size={12}
            className="smtcmp-chat-user-input-file-badge-name-icon"
          />
        )}
        <span
          className={clsx(
            !settings.chatOptions.includeCurrentFileContent &&
              'smtcmp-excluded-content',
          )}
        >
          {mentionable.file.name}
        </span>
      </div>
      <div
        className={clsx(
          'smtcmp-chat-user-input-file-badge-name-suffix',
          !settings.chatOptions.includeCurrentFileContent &&
            'smtcmp-excluded-content',
        )}
      >
        {' (Current File)'}
      </div>
    </BadgeBase>
  ) : null
}

function BlockBadge({
  mentionable,
  onDelete,
  onClick,
  isFocused,
}: {
  mentionable: MentionableBlock
  onDelete: () => void
  onClick: () => void
  isFocused: boolean
}) {
  const Icon = getMentionableIcon(mentionable)
  return (
    <BadgeBase
      onDelete={onDelete}
      onClick={onClick}
      isFocused={isFocused}
      label={getMentionableName(mentionable)}
    >
      <div className="smtcmp-chat-user-input-file-badge-name">
        {Icon && (
          <Icon
            size={12}
            className="smtcmp-chat-user-input-file-badge-name-icon"
          />
        )}
        <span>{mentionable.file.name}</span>
      </div>
      <div className="smtcmp-chat-user-input-file-badge-name-suffix">
        {` (${mentionable.startLine}:${mentionable.endLine})`}
      </div>
    </BadgeBase>
  )
}

function UrlBadge({
  mentionable,
  onDelete,
  onClick,
  isFocused,
}: {
  mentionable: MentionableUrl
  onDelete: () => void
  onClick: () => void
  isFocused: boolean
}) {
  const Icon = getMentionableIcon(mentionable)
  return (
    <BadgeBase
      onDelete={onDelete}
      onClick={onClick}
      isFocused={isFocused}
      label={getMentionableName(mentionable)}
    >
      <div className="smtcmp-chat-user-input-file-badge-name">
        {Icon && (
          <Icon
            size={12}
            className="smtcmp-chat-user-input-file-badge-name-icon"
          />
        )}
        <span>{mentionable.url}</span>
      </div>
    </BadgeBase>
  )
}

function ImageBadge({
  mentionable,
  onDelete,
  onClick,
  isFocused,
}: {
  mentionable: MentionableImage
  onDelete: () => void
  onClick: () => void
  isFocused: boolean
}) {
  const Icon = getMentionableIcon(mentionable)
  return (
    <BadgeBase
      onDelete={onDelete}
      onClick={onClick}
      isFocused={isFocused}
      label={getMentionableName(mentionable)}
    >
      <div className="smtcmp-chat-user-input-file-badge-name">
        {Icon && (
          <Icon
            size={12}
            className="smtcmp-chat-user-input-file-badge-name-icon"
          />
        )}
        <span>{mentionable.name}</span>
      </div>
    </BadgeBase>
  )
}

export default function MentionableBadge({
  mentionable,
  onDelete,
  onClick,
  isFocused = false,
}: {
  mentionable: Mentionable
  onDelete: () => void
  onClick: () => void
  isFocused?: boolean
}) {
  switch (mentionable.type) {
    case 'file':
      return (
        <FileBadge
          mentionable={mentionable}
          onDelete={onDelete}
          onClick={onClick}
          isFocused={isFocused}
        />
      )
    case 'folder':
      return (
        <FolderBadge
          mentionable={mentionable}
          onDelete={onDelete}
          onClick={onClick}
          isFocused={isFocused}
        />
      )
    case 'vault':
      return (
        <VaultBadge
          mentionable={mentionable}
          onDelete={onDelete}
          onClick={onClick}
          isFocused={isFocused}
        />
      )
    case 'current-file':
      return (
        <CurrentFileBadge
          mentionable={mentionable}
          onDelete={onDelete}
          onClick={onClick}
          isFocused={isFocused}
        />
      )
    case 'block':
      return (
        <BlockBadge
          mentionable={mentionable}
          onDelete={onDelete}
          onClick={onClick}
          isFocused={isFocused}
        />
      )
    case 'url':
      return (
        <UrlBadge
          mentionable={mentionable}
          onDelete={onDelete}
          onClick={onClick}
          isFocused={isFocused}
        />
      )
    case 'image':
      return (
        <ImageBadge
          mentionable={mentionable}
          onDelete={onDelete}
          onClick={onClick}
          isFocused={isFocused}
        />
      )
  }
}
