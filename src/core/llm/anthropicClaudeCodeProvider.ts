import {
  CLAUDE_CODE_DEFAULT_BETAS,
  CLAUDE_CODE_USER_AGENT,
} from '../../constants'
import { ChatModel } from '../../types/chat-model.types'
import {
  LLMOptions,
  LLMRequestNonStreaming,
  LLMRequestStreaming,
} from '../../types/llm/request'
import {
  LLMResponseNonStreaming,
  LLMResponseStreaming,
} from '../../types/llm/response'
import { LLMProvider } from '../../types/provider.types'

import { BaseLLMProvider } from './base'
import { refreshClaudeCodeAccessToken } from './claudeCodeAuth'
import { ClaudeCodeMessageAdapter } from './claudeCodeMessageAdapter'
import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
} from './exception'
import {
  PlanProviderUpdateCallback,
  refreshPlanProviderOnce,
} from './planProviderRefresh'
import { redactAuthError } from './redactAuthError'

export class AnthropicClaudeCodeProvider extends BaseLLMProvider<
  Extract<LLMProvider, { type: 'anthropic-plan' }>
> {
  private adapter: ClaudeCodeMessageAdapter
  private onProviderUpdate?: PlanProviderUpdateCallback

  constructor(
    provider: Extract<LLMProvider, { type: 'anthropic-plan' }>,
    onProviderUpdate?: PlanProviderUpdateCallback,
  ) {
    super({
      ...provider,
      oauth: provider.oauth ? { ...provider.oauth } : undefined,
    })
    this.adapter = new ClaudeCodeMessageAdapter()
    this.onProviderUpdate = onProviderUpdate
  }

  async generateResponse(
    model: ChatModel,
    request: LLMRequestNonStreaming,
    options?: LLMOptions,
  ): Promise<LLMResponseNonStreaming> {
    if (model.providerType !== 'anthropic-plan') {
      throw new Error('Model is not a Claude Code model')
    }
    const headers = await this.getAuthHeaders()
    return this.adapter.generateResponse(
      request,
      options,
      headers,
      model.thinking,
    )
  }

  async streamResponse(
    model: ChatModel,
    request: LLMRequestStreaming,
    options?: LLMOptions,
  ): Promise<AsyncIterable<LLMResponseStreaming>> {
    if (model.providerType !== 'anthropic-plan') {
      throw new Error('Model is not a Claude Code model')
    }
    const headers = await this.getAuthHeaders()
    return this.adapter.streamResponse(
      request,
      options,
      headers,
      model.thinking,
    )
  }

  async getEmbedding(
    _model: string,
    _text: string,
    _options?: { dimensions?: number; signal?: AbortSignal },
  ): Promise<number[]> {
    throw new Error(
      `Provider ${this.provider.id} does not support embeddings. Please use a different provider.`,
    )
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    if (!this.provider.oauth?.refreshToken) {
      throw new LLMAPIKeyNotSetException(
        `Provider ${this.provider.id} OAuth credentials are missing. Please log in.`,
      )
    }

    if (
      !this.provider.oauth.accessToken ||
      this.provider.oauth.expiresAt <= Date.now()
    ) {
      try {
        const previousRefreshToken = this.provider.oauth.refreshToken
        const updatedOauth = await refreshPlanProviderOnce(
          this.provider,
          previousRefreshToken,
          async () => {
            const tokens =
              await refreshClaudeCodeAccessToken(previousRefreshToken)
            const oauth = {
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token ?? previousRefreshToken,
              expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
            }
            this.provider.oauth = oauth
            await this.onProviderUpdate?.(
              this.provider.id,
              { oauth },
              {
                providerType: this.provider.type,
                refreshToken: previousRefreshToken,
              },
            )
            return oauth
          },
        )
        this.provider.oauth = updatedOauth
      } catch (error) {
        throw new LLMAPIKeyInvalidException(
          'Claude Code OAuth token refresh failed. Please log in again.',
          redactAuthError(error, [this.provider.oauth.refreshToken]),
        )
      }
    }

    return {
      authorization: `Bearer ${this.provider.oauth.accessToken}`,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': CLAUDE_CODE_DEFAULT_BETAS.join(','),
      'user-agent': CLAUDE_CODE_USER_AGENT,
    }
  }
}
