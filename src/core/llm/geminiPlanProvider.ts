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
import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
} from './exception'
import { refreshGeminiAccessToken } from './geminiAuth'
import { GeminiCodeAssistAdapter } from './geminiCodeAssistAdapter'
import {
  ensureProjectContext,
  invalidateProjectContextCache,
} from './geminiProject'
import {
  PlanProviderUpdateCallback,
  refreshPlanProviderOnce,
} from './planProviderRefresh'
import { redactAuthError } from './redactAuthError'

export class GeminiPlanProvider extends BaseLLMProvider<
  Extract<LLMProvider, { type: 'gemini-plan' }>
> {
  private adapter: GeminiCodeAssistAdapter
  private onProviderUpdate?: PlanProviderUpdateCallback

  constructor(
    provider: Extract<LLMProvider, { type: 'gemini-plan' }>,
    onProviderUpdate?: PlanProviderUpdateCallback,
  ) {
    super({
      ...provider,
      oauth: provider.oauth ? { ...provider.oauth } : undefined,
    })
    this.adapter = new GeminiCodeAssistAdapter()
    this.onProviderUpdate = onProviderUpdate
  }

  async generateResponse(
    model: ChatModel,
    request: LLMRequestNonStreaming,
    options?: LLMOptions,
  ): Promise<LLMResponseNonStreaming> {
    if (model.providerType !== 'gemini-plan') {
      throw new Error('Model is not a Gemini Plan model')
    }
    const { headers, projectId } = await this.getAuthContext()
    return this.adapter.generateResponse(
      model,
      request,
      headers,
      projectId,
      options,
    )
  }

  async streamResponse(
    model: ChatModel,
    request: LLMRequestStreaming,
    options?: LLMOptions,
  ): Promise<AsyncIterable<LLMResponseStreaming>> {
    if (model.providerType !== 'gemini-plan') {
      throw new Error('Model is not a Gemini Plan model')
    }
    const { headers, projectId } = await this.getAuthContext()
    return this.adapter.streamResponse(
      model,
      request,
      headers,
      projectId,
      options,
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

  private async getAuthContext(): Promise<{
    headers: Record<string, string>
    projectId: string
  }> {
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
            invalidateProjectContextCache(previousRefreshToken)
            const tokens = await refreshGeminiAccessToken(previousRefreshToken)
            const oauth = {
              ...this.provider.oauth,
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token ?? previousRefreshToken,
              expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
            }
            if (
              tokens.refresh_token &&
              tokens.refresh_token !== previousRefreshToken
            ) {
              invalidateProjectContextCache(tokens.refresh_token)
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
          'Gemini OAuth token refresh failed. Please log in again.',
          redactAuthError(error, [this.provider.oauth.refreshToken]),
        )
      }
    }

    const authState = this.provider.oauth
    const projectContext = await ensureProjectContext({
      auth: {
        refreshToken: authState.refreshToken,
        accessToken: authState.accessToken,
        projectId: authState.projectId,
        managedProjectId: authState.managedProjectId,
      },
      onUpdate: async (nextAuth) => {
        const updatedOauth = {
          ...authState,
          projectId: nextAuth.projectId,
          managedProjectId: nextAuth.managedProjectId,
        }
        await this.onProviderUpdate?.(this.provider.id, {
          oauth: updatedOauth,
        })
        this.provider.oauth = updatedOauth
      },
    })

    const headers: Record<string, string> = {
      authorization: `Bearer ${authState.accessToken}`,
    }

    return {
      headers,
      projectId: projectContext.effectiveProjectId,
    }
  }
}
