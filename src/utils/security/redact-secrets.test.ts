import { redactSecrets } from './redact-secrets'

describe('redactSecrets', () => {
  it('redacts nested provider tokens', () => {
    // Given: nested provider credentials in an object-like diagnostic payload.
    const diagnostic = {
      provider: {
        type: 'openai-plan',
        apiKey: 'sk-test-secret',
        oauth: {
          accessToken: 'access-token-test',
          refreshToken: 'refresh-token-test',
        },
      },
      status: 401,
    }

    // When: the diagnostic payload is redacted.
    const redacted = redactSecrets(diagnostic)
    const serialized = JSON.stringify(redacted)

    // Then: secret values are removed while useful context remains.
    expect(serialized).not.toContain('sk-test-secret')
    expect(serialized).not.toContain('access-token-test')
    expect(serialized).not.toContain('refresh-token-test')
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).toContain('openai-plan')
    expect(serialized).toContain('401')
  })

  it('redacts authorization headers', () => {
    // Given: a string diagnostic containing a bearer token.
    const diagnostic =
      'request failed with Authorization: Bearer secret-bearer-token'

    // When: the diagnostic string is redacted.
    const redacted = redactSecrets(diagnostic)

    // Then: the bearer token is hidden and the header context remains.
    expect(redacted).toBe(
      'request failed with Authorization: Bearer [REDACTED]',
    )
  })

  it('redacts URL query secret parameters', () => {
    // Given: provider errors can include callback URLs or request URLs.
    const diagnostic =
      'request failed: https://example.com/callback?code=oauth-code-secret&access_token=access-token-secret&safe=value'

    // When: the free-form message is redacted.
    const redacted = redactSecrets(diagnostic)

    // Then: secret query values are hidden without dropping non-secret context.
    expect(redacted).toContain('code=[REDACTED]')
    expect(redacted).toContain('access_token=[REDACTED]')
    expect(redacted).toContain('safe=value')
    expect(redacted).not.toContain('oauth-code-secret')
    expect(redacted).not.toContain('access-token-secret')
  })

  it('redacts common query secret parameters', () => {
    // Given: arbitrary errors can include common secret-bearing query fields.
    const diagnostic =
      'url?api_key=api-key-value&api-key=api-dash-key-value&apikey=api-compact-key-value&refresh_token=refresh-token-value&client_secret=client-secret-value&id_token=id-token-value&token=token-value&password=password-value&secret=secret-value&safe=value'

    // When: the free-form message is redacted.
    const redacted = redactSecrets(diagnostic)

    // Then: common secret query values are hidden without dropping safe context.
    expect(redacted).toContain('api_key=[REDACTED]')
    expect(redacted).toContain('api-key=[REDACTED]')
    expect(redacted).toContain('apikey=[REDACTED]')
    expect(redacted).toContain('refresh_token=[REDACTED]')
    expect(redacted).toContain('client_secret=[REDACTED]')
    expect(redacted).toContain('id_token=[REDACTED]')
    expect(redacted).toContain('token=[REDACTED]')
    expect(redacted).toContain('password=[REDACTED]')
    expect(redacted).toContain('secret=[REDACTED]')
    expect(redacted).toContain('safe=value')
    expect(redacted).not.toContain('api-key-value')
    expect(redacted).not.toContain('api-dash-key-value')
    expect(redacted).not.toContain('api-compact-key-value')
    expect(redacted).not.toContain('refresh-token-value')
    expect(redacted).not.toContain('client-secret-value')
    expect(redacted).not.toContain('id-token-value')
    expect(redacted).not.toContain('token-value')
    expect(redacted).not.toContain('password-value')
    expect(redacted).not.toContain('secret-value')
  })

  it('redacts MCP env secrets', () => {
    // Given: MCP server parameters containing environment secrets.
    const diagnostic = {
      server: 'github',
      parameters: {
        command: 'node',
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: 'github-personal-access-token-test',
          NORMAL_FLAG: 'debug',
        },
      },
    }

    // When: the diagnostic payload is redacted.
    const redacted = redactSecrets(diagnostic)
    const serialized = JSON.stringify(redacted)

    // Then: env secret values are hidden while non-secret values remain.
    expect(serialized).not.toContain('github-personal-access-token-test')
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).toContain('debug')
  })

  it('redacts OAuth authorization codes', () => {
    // Given: OAuth callback details containing an authorization code.
    const diagnostic = {
      callback: 'http://localhost:1455/auth/callback',
      code: 'oauth-code-test',
      state: 'state-test',
    }

    // When: the callback details are redacted.
    const redacted = redactSecrets(diagnostic)
    const serialized = JSON.stringify(redacted)

    // Then: the authorization code is hidden while state remains diagnosable.
    expect(serialized).not.toContain('oauth-code-test')
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).toContain('state-test')
  })

  it('redacts tool result error values', () => {
    // Given: a tool error string that includes a secret-shaped value.
    const diagnostic = new Error(
      'tool failed: Authorization: Bearer tool-result-secret',
    )

    // When: the error is redacted.
    const redacted = redactSecrets(diagnostic)

    // Then: the Error shape is preserved without the secret value.
    expect(redacted).toBeInstanceOf(Error)
    expect(redacted.message).toBe(
      'tool failed: Authorization: Bearer [REDACTED]',
    )
  })

  it('keeps non-secret diagnostic context', () => {
    // Given: diagnostic context without secret-bearing fields.
    const diagnostic = {
      provider: 'openai',
      status: 429,
      operation: 'streamChat',
      message: 'rate limited',
    }

    // When: the context is redacted.
    const redacted = redactSecrets(diagnostic)

    // Then: non-secret context is preserved.
    expect(redacted).toEqual(diagnostic)
  })
})
