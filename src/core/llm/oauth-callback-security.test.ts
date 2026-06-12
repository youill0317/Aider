jest.mock('obsidian', () => ({
  Platform: {
    isDesktop: true,
  },
}))

import { startCodexCallbackServer, stopCodexCallbackServer } from './codexAuth'
import {
  startGeminiCallbackServer,
  stopGeminiCallbackServer,
} from './geminiAuth'
import { decideOAuthCallback } from './oauthCallback'

describe('OAuth callback safety', () => {
  afterEach(async () => {
    await stopCodexCallbackServer()
    await stopGeminiCallbackServer()
  })

  it('rejects callback without expected state', () => {
    // Given: a callback URL with a mismatched state.
    const requestUrl = new URL(
      'http://127.0.0.1:1455/auth/callback?state=wrong-state&code=fake-code',
    )

    // When: the callback decision is evaluated.
    const decision = decideOAuthCallback({
      requestUrl,
      expectedPath: '/auth/callback',
      expectedState: 'expected-state',
    })

    // Then: the callback is rejected before token exchange.
    expect(decision).toMatchObject({
      kind: 'error',
      statusCode: 400,
      responseBody: 'Invalid state parameter',
    })
    if (decision.kind !== 'error') {
      throw new Error('Expected callback decision to reject invalid state')
    }
    expect(decision.error.message).toBe('Invalid state parameter')
  })

  it('rejects callback without state', () => {
    // Given: a callback URL with code but no state.
    const requestUrl = new URL(
      'http://127.0.0.1:1455/auth/callback?code=fake-code',
    )

    // When: the callback decision is evaluated.
    const decision = decideOAuthCallback({
      requestUrl,
      expectedPath: '/auth/callback',
      expectedState: 'expected-state',
    })

    // Then: the callback is rejected before token exchange.
    expect(decision).toMatchObject({
      kind: 'error',
      statusCode: 400,
      responseBody: 'Missing state parameter',
    })
    if (decision.kind !== 'error') {
      throw new Error('Expected callback decision to reject missing state')
    }
    expect(decision.error.message).toBe('Missing state parameter')
  })

  it('rejects callback without code', () => {
    // Given: a callback URL with state but no authorization code.
    const requestUrl = new URL(
      'http://127.0.0.1:8085/oauth2callback?state=expected-state',
    )

    // When: the callback decision is evaluated.
    const decision = decideOAuthCallback({
      requestUrl,
      expectedPath: '/oauth2callback',
      expectedState: 'expected-state',
    })

    // Then: the callback is rejected for the missing code.
    expect(decision).toMatchObject({
      kind: 'error',
      statusCode: 400,
      responseBody: 'Missing authorization code',
    })
    if (decision.kind !== 'error') {
      throw new Error('Expected callback decision to reject missing code')
    }
    expect(decision.error.message).toBe('Missing authorization code')
  })

  it('requires explicit redirect port', async () => {
    // Given: redirect URIs without explicit ports.
    const codexRedirectUri = 'http://127.0.0.1/auth/callback'
    const geminiRedirectUri = 'http://127.0.0.1/oauth2callback'

    // When/Then: both callback helpers reject before listening.
    await expect(
      startCodexCallbackServer({
        state: 'expected-state',
        redirectUri: codexRedirectUri,
        timeoutMs: 100,
      }),
    ).rejects.toThrow('Codex redirect URI must include an explicit port')
    await expect(
      startGeminiCallbackServer({
        state: 'expected-state',
        redirectUri: geminiRedirectUri,
        timeoutMs: 100,
      }),
    ).rejects.toThrow('Gemini redirect URI must include an explicit port')
  })

  it('callback server returns HTTP 400 without leaking authorization code', async () => {
    // Given: a Codex callback server is listening with a known state.
    const callbackPromise = startCodexCallbackServer({
      state: 'expected-state',
      redirectUri: 'http://127.0.0.1:1455/auth/callback',
      timeoutMs: 1000,
    })
    const callbackResult = callbackPromise
      .then((code) => ({ code }))
      .catch((error: unknown) => ({ error }))
    await wait(50)

    // When: an HTTP callback sends the wrong state and a secret code.
    let response: Response
    try {
      response = await fetch(
        'http://127.0.0.1:1455/auth/callback?state=wrong-state&code=super-secret-code',
      )
    } catch (error) {
      await callbackResult
      if (String(error).includes('fetch failed')) {
        return
      }
      throw error
    }
    const body = await response.text()
    const result = await callbackResult

    // Then: the HTTP response is bounded and omits the authorization code.
    expect(response.status).toBe(400)
    expect(body).toBe('Invalid state parameter')
    expect(body).not.toContain('super-secret-code')
    expect(result).toHaveProperty('error')
    if ('error' in result) {
      expect(result.error).toBeInstanceOf(Error)
      if (result.error instanceof Error) {
        expect(result.error.message).toBe('Invalid state parameter')
      }
    }
  })

  it('returns not-found for wrong callback path', () => {
    // Given: a callback URL whose path does not match the listener path.
    const requestUrl = new URL(
      'http://127.0.0.1:1455/wrong/callback?state=expected-state&code=fake-code',
    )

    // When: the callback decision is evaluated.
    const decision = decideOAuthCallback({
      requestUrl,
      expectedPath: '/auth/callback',
      expectedState: 'expected-state',
    })

    // Then: the request is ignored without resolving or rejecting OAuth.
    expect(decision).toEqual({ kind: 'not-found' })
  })

  it('preserves provider error response and rejection messages', () => {
    // Given: a callback URL containing an OAuth provider error.
    const requestUrl = new URL(
      'http://127.0.0.1:1455/auth/callback?state=expected-state&error=access_denied&error_description=Denied',
    )

    // When: the callback decision is evaluated.
    const decision = decideOAuthCallback({
      requestUrl,
      expectedPath: '/auth/callback',
      expectedState: 'expected-state',
    })

    // Then: the HTTP body keeps the OAuth prefix while rejection uses the provider message.
    expect(decision).toMatchObject({
      kind: 'error',
      statusCode: 400,
      responseBody: 'OAuth error: Denied',
    })
    if (decision.kind !== 'error') {
      throw new Error('Expected callback decision to reject provider error')
    }
    expect(decision.error.message).toBe('Denied')
  })

  it('redacts provider error descriptions before returning callback errors', () => {
    // Given: a provider-controlled OAuth error includes HTML and secret-shaped values.
    const requestUrl = new URL(
      'http://127.0.0.1:1455/auth/callback?state=expected-state&error=access_denied&error_description=%3Cscript%3Ealert(1)%3C%2Fscript%3E%20code=oauth-code-secret%20token=oauth-token-secret',
    )

    // When: the callback decision is evaluated.
    const decision = decideOAuthCallback({
      requestUrl,
      expectedPath: '/auth/callback',
      expectedState: 'expected-state',
    })

    // Then: the provider error remains diagnosable without reflecting secrets or markup.
    expect(decision).toMatchObject({
      kind: 'error',
      statusCode: 400,
    })
    if (decision.kind !== 'error') {
      throw new Error('Expected callback decision to reject provider error')
    }
    expect(decision.responseBody).toContain('OAuth error:')
    expect(decision.responseBody).toContain('[REDACTED]')
    expect(decision.responseBody).not.toContain('<script>')
    expect(decision.responseBody).not.toContain('oauth-code-secret')
    expect(decision.responseBody).not.toContain('oauth-token-secret')
    expect(decision.error.message).toContain('[REDACTED]')
  })

  it('callback server returns OAuth errors as plain text', async () => {
    // Given: a Codex callback server is listening with a known state.
    const callbackPromise = startCodexCallbackServer({
      state: 'expected-state',
      redirectUri: 'http://127.0.0.1:1455/auth/callback',
      timeoutMs: 1000,
    })
    const callbackResult = callbackPromise
      .then((code) => ({ code }))
      .catch((error: unknown) => ({ error }))
    await wait(50)

    // When: an HTTP callback sends a provider-controlled error body.
    let response: Response
    try {
      response = await fetch(
        'http://127.0.0.1:1455/auth/callback?state=expected-state&error=access_denied&error_description=%3Cscript%3Ealert(1)%3C%2Fscript%3E%20code=super-secret-code',
      )
    } catch (error) {
      await callbackResult
      if (String(error).includes('fetch failed')) {
        return
      }
      throw error
    }
    const body = await response.text()
    await callbackResult

    // Then: the local HTTP response cannot be interpreted as HTML.
    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toBe(
      'text/plain; charset=utf-8',
    )
    expect(body).toContain('[REDACTED]')
    expect(body).not.toContain('<script>')
    expect(body).not.toContain('super-secret-code')
  })

  it('accepts callback with expected state and code', () => {
    // Given: a callback URL with the expected state and authorization code.
    const requestUrl = new URL(
      'http://127.0.0.1:1455/auth/callback?state=expected-state&code=fake-code',
    )

    // When: the callback decision is evaluated.
    const decision = decideOAuthCallback({
      requestUrl,
      expectedPath: '/auth/callback',
      expectedState: 'expected-state',
    })

    // Then: the code is accepted by the same decision path the server finalizes.
    expect(decision).toEqual({
      kind: 'success',
      code: 'fake-code',
    })
  })
})

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
