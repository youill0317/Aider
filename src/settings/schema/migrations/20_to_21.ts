import { SettingMigration } from '../setting.types'

import { DEFAULT_CHAT_MODELS_V16 } from './15_to_16'
import { getMigratedChatModels } from './migrationUtils'

/**
 * Migration from version 20 to version 21
 * - Refresh the default chat model line-up:
 *   - claude-opus-5 (plan + api)
 *   - gpt-5.6-sol, gpt-5.6-luna (plan + api)
 *   - gpt-5.3-codex-spark (api, disabled by default — design-partner only)
 *   - gemini-3.1-pro-preview, gemini-3.6-flash (plan + api)
 *
 * Superseded defaults (claude 4.5, gpt-5.2, gemini-3 preview, ...) are not
 * removed: getMigratedChatModels carries anything already in the user's
 * settings through as a custom model, so an existing selection keeps working.
 */
const DEFAULT_CHAT_MODELS_V21 = [
  // claude-opus-5 rejects thinking.budget_tokens with a 400 and thinks
  // adaptively when the field is absent, so it carries no thinking block.
  {
    providerType: 'anthropic-plan',
    providerId: 'anthropic-plan',
    id: 'claude-opus-5 (plan)',
    model: 'claude-opus-5',
  },
  {
    providerType: 'openai-plan',
    providerId: 'openai-plan',
    id: 'gpt-5.6-sol (plan)',
    model: 'gpt-5.6-sol',
  },
  {
    providerType: 'openai-plan',
    providerId: 'openai-plan',
    id: 'gpt-5.6-luna (plan)',
    model: 'gpt-5.6-luna',
  },
  {
    providerType: 'gemini-plan',
    providerId: 'gemini-plan',
    id: 'gemini-3.1-pro-preview (plan)',
    model: 'gemini-3.1-pro-preview',
  },
  {
    providerType: 'gemini-plan',
    providerId: 'gemini-plan',
    id: 'gemini-3.6-flash (plan)',
    model: 'gemini-3.6-flash',
  },
  {
    providerType: 'anthropic',
    providerId: 'anthropic',
    id: 'claude-opus-5',
    model: 'claude-opus-5',
  },
  {
    providerType: 'openai',
    providerId: 'openai',
    id: 'gpt-5.6-sol',
    model: 'gpt-5.6-sol',
  },
  {
    providerType: 'openai',
    providerId: 'openai',
    id: 'gpt-5.6-luna',
    model: 'gpt-5.6-luna',
  },
  {
    providerType: 'openai',
    providerId: 'openai',
    id: 'gpt-5.3-codex-spark',
    model: 'gpt-5.3-codex-spark',
    enable: false,
  },
  {
    providerType: 'gemini',
    providerId: 'gemini',
    id: 'gemini-3.1-pro-preview',
    model: 'gemini-3.1-pro-preview',
  },
  {
    providerType: 'gemini',
    providerId: 'gemini',
    id: 'gemini-3.6-flash',
    model: 'gemini-3.6-flash',
  },
  ...DEFAULT_CHAT_MODELS_V16,
]

export const migrateFrom20To21: SettingMigration['migrate'] = (data) => {
  const newData = { ...data }
  newData.version = 21

  newData.chatModels = getMigratedChatModels(
    newData,
    DEFAULT_CHAT_MODELS_V21,
    DEFAULT_CHAT_MODELS_V16,
  )

  return newData
}
