jest.mock('obsidian', () => ({
  Platform: {
    isDesktop: true,
  },
}))

jest.mock('../../utils/llm/httpTransport', () => ({
  postFormUrlEncoded: jest.fn(),
}))

import { CLAUDE_CODE_OAUTH_TOKEN_ENDPOINT } from '../../constants'
import { postFormUrlEncoded } from '../../utils/llm/httpTransport'

import { exchangeClaudeCodeForTokens } from './claudeCodeAuth'

describe('Claude Code OAuth state validation', () => {
  const postFormMock = jest.mocked(postFormUrlEncoded)

  beforeEach(() => {
    jest.resetAllMocks()
  })

  it.each(['authorization-code', 'authorization-code#wrong-state'])(
    'rejects a manual code without the expected state: %s',
    async (code) => {
      await expect(
        exchangeClaudeCodeForTokens({
          code,
          pkceVerifier: 'verifier',
          state: 'expected-state',
        }),
      ).rejects.toThrow('Invalid OAuth state')
      expect(postFormMock).not.toHaveBeenCalled()
    },
  )

  it('exchanges the code with the verified expected state', async () => {
    postFormMock.mockResolvedValueOnce({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    })

    await exchangeClaudeCodeForTokens({
      code: 'authorization-code#expected-state',
      pkceVerifier: 'verifier',
      state: 'expected-state',
    })

    expect(postFormMock).toHaveBeenCalledWith(
      CLAUDE_CODE_OAUTH_TOKEN_ENDPOINT,
      expect.objectContaining({
        code: 'authorization-code',
        state: 'expected-state',
      }),
    )
  })
})
