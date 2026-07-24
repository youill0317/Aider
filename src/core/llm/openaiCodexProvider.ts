import { Reasoning, ReasoningEffort } from 'openai/resources/shared'

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
import { extractCodexAccountId, refreshCodexAccessToken } from './codexAuth'
import { CodexMessageAdapter } from './codexMessageAdapter'
import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
} from './exception'
import {
  PlanProviderUpdateCallback,
  refreshPlanProviderOnce,
} from './planProviderRefresh'
import { redactAuthError } from './redactAuthError'

export class OpenAICodexProvider extends BaseLLMProvider<
  Extract<LLMProvider, { type: 'openai-plan' }>
> {
  private adapter: CodexMessageAdapter
  private onProviderUpdate?: PlanProviderUpdateCallback

  constructor(
    provider: Extract<LLMProvider, { type: 'openai-plan' }>,
    onProviderUpdate?: PlanProviderUpdateCallback,
  ) {
    super({
      ...provider,
      oauth: provider.oauth ? { ...provider.oauth } : undefined,
    })
    this.adapter = new CodexMessageAdapter()
    this.onProviderUpdate = onProviderUpdate
  }

  async generateResponse(
    model: ChatModel,
    request: LLMRequestNonStreaming,
    options?: LLMOptions,
  ): Promise<LLMResponseNonStreaming> {
    if (model.providerType !== 'openai-plan') {
      throw new Error('Model is not an OpenAI Codex model')
    }

    const authHeaders = await this.getAuthHeaders()
    const normalizedRequest = this.normalizeRequest(model, request)
    return this.adapter.generateResponse(
      normalizedRequest,
      options,
      authHeaders,
    )
  }

  async streamResponse(
    model: ChatModel,
    request: LLMRequestStreaming,
    options?: LLMOptions,
  ): Promise<AsyncIterable<LLMResponseStreaming>> {
    if (model.providerType !== 'openai-plan') {
      throw new Error('Model is not an OpenAI Codex model')
    }

    const authHeaders = await this.getAuthHeaders()
    const normalizedRequest = this.normalizeRequest(model, request)
    return this.adapter.streamResponse(normalizedRequest, options, authHeaders)
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
        const previousOauth = this.provider.oauth
        const previousRefreshToken = previousOauth.refreshToken
        const updatedOauth = await refreshPlanProviderOnce(
          this.provider,
          previousRefreshToken,
          async () => {
            const tokens = await refreshCodexAccessToken(previousRefreshToken)
            const accountId = extractCodexAccountId(tokens)
            const oauth = {
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token ?? previousRefreshToken,
              expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
              accountId: accountId ?? previousOauth.accountId,
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
          'OpenAI Codex OAuth token refresh failed. Please log in again.',
          redactAuthError(error, [this.provider.oauth.refreshToken]),
        )
      }
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.provider.oauth.accessToken}`,
    }

    if (this.provider.oauth.accountId) {
      headers['ChatGPT-Account-Id'] = this.provider.oauth.accountId
    }

    return headers
  }

  private normalizeRequest<
    T extends LLMRequestNonStreaming | LLMRequestStreaming,
  >(model: Extract<ChatModel, { providerType: 'openai-plan' }>, request: T): T {
    const reasoningEffort = model.reasoning?.reasoning_effort
    const reasoningSummary = model.reasoning?.reasoning_summary
    return {
      ...request,
      reasoning_effort: reasoningEffort
        ? (reasoningEffort as ReasoningEffort)
        : undefined,
      reasoning_summary: reasoningSummary
        ? (reasoningSummary as Reasoning['summary'])
        : undefined,
    }
  }
}
