jest.mock('obsidian', () => ({
  Platform: {
    isDesktop: true,
  },
}))

jest.mock('./codexAuth', () => {
  const actual = jest.requireActual<typeof import('./codexAuth')>('./codexAuth')
  return {
    ...actual,
    refreshCodexAccessToken: jest.fn(),
  }
})

jest.mock('./geminiAuth', () => {
  const actual =
    jest.requireActual<typeof import('./geminiAuth')>('./geminiAuth')
  return {
    ...actual,
    refreshGeminiAccessToken: jest.fn(),
  }
})

import { ChatModel } from '../../types/chat-model.types'

import {
  exchangeCodexCodeForTokens,
  refreshCodexAccessToken,
} from './codexAuth'
import { LLMAPIKeyInvalidException } from './exception'
import { refreshGeminiAccessToken } from './geminiAuth'
import { GeminiPlanProvider } from './geminiPlanProvider'
import { decideOAuthCallback } from './oauthCallback'
import { OpenAICodexProvider } from './openaiCodexProvider'

describe('OAuth and provider auth error redaction', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('token exchange error omits authorization code', async () => {
    // Given: Codex token exchange fails for a secret authorization code.
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 400,
    } as Response)

    // When/Then: the thrown error is bounded to status context.
    const error = await captureError(() =>
      exchangeCodexCodeForTokens({
        code: 'super-secret-code',
        pkceVerifier: 'verifier',
      }),
    )

    expect(error.message).toBe('Codex token exchange failed: 400')
    expect(error.message).not.toContain('super-secret-code')
  })

  it('refresh failure omits refresh token', async () => {
    // Given: OpenAI plan refresh throws an error containing the refresh token.
    const refreshMock = jest.mocked(refreshCodexAccessToken)
    refreshMock.mockRejectedValueOnce(
      new Error('upstream rejected refresh-token-test'),
    )
    const provider = new OpenAICodexProvider({
      id: 'openai-plan',
      type: 'openai-plan',
      oauth: {
        accessToken: '',
        refreshToken: 'refresh-token-test',
        expiresAt: 0,
      },
    })

    // When: provider auth refresh fails.
    const error = await captureError(() =>
      provider.generateResponse(createPlanModel('openai-plan'), {
        model: 'gpt-5',
        messages: [],
      }),
    )

    // Then: the public and raw error messages are redacted.
    expect(error).toBeInstanceOf(LLMAPIKeyInvalidException)
    expect(error.message).not.toContain('refresh-token-test')
    expect(
      (error as LLMAPIKeyInvalidException).rawError?.message,
    ).not.toContain('refresh-token-test')
  })

  it('manual redirect state mismatch preserves UX copy', () => {
    // Given: a manual redirect includes wrong state and a secret code.
    const decision = decideOAuthCallback({
      requestUrl: new URL(
        'http://127.0.0.1:1455/auth/callback?state=wrong&code=super-secret-code',
      ),
      expectedPath: '/auth/callback',
      expectedState: 'expected',
    })

    // When/Then: bounded UX copy is preserved and code is omitted.
    expect(decision).toMatchObject({
      kind: 'error',
      responseBody: 'Invalid state parameter',
    })
    if (decision.kind !== 'error') {
      throw new Error('Expected invalid-state decision')
    }
    expect(decision.error.message).toBe('Invalid state parameter')
    expect(decision.responseBody).not.toContain('super-secret-code')
  })

  it('Gemini refresh failure omits refresh token', async () => {
    // Given: Gemini refresh throws an error containing the refresh token.
    const refreshMock = jest.mocked(refreshGeminiAccessToken)
    refreshMock.mockRejectedValueOnce(
      new Error('upstream rejected refresh-token-test'),
    )
    const provider = new GeminiPlanProvider({
      id: 'gemini-plan',
      type: 'gemini-plan',
      oauth: {
        accessToken: '',
        refreshToken: 'refresh-token-test',
        expiresAt: 0,
      },
    })

    // When: provider auth refresh fails.
    const error = await captureError(() =>
      provider.generateResponse(createPlanModel('gemini-plan'), {
        model: 'gemini',
        messages: [],
      }),
    )

    // Then: the public and raw error messages are redacted.
    expect(error).toBeInstanceOf(LLMAPIKeyInvalidException)
    expect(error.message).not.toContain('refresh-token-test')
    expect(
      (error as LLMAPIKeyInvalidException).rawError?.message,
    ).not.toContain('refresh-token-test')
  })
})

async function captureError(action: () => Promise<unknown>): Promise<Error> {
  try {
    await action()
  } catch (error) {
    if (error instanceof Error) {
      return error
    }
  }
  throw new Error('Expected action to throw')
}

function createPlanModel(
  providerType: 'openai-plan' | 'gemini-plan',
): ChatModel {
  return {
    id: `${providerType}-model`,
    providerType,
    providerId: providerType,
    model: 'model',
  }
}
