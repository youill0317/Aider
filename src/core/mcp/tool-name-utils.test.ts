import { InvalidToolNameException } from './exception'
import {
  getToolName,
  parseToolName,
  validateServerName,
} from './tool-name-utils'

describe('MCP tool-name utilities', () => {
  it('rejects delimiter injection', () => {
    // Given: a server name containing the tool-name delimiter.
    const serverName = 'github__filesystem'

    // When/Then: server validation rejects the delimiter.
    expect(() => validateServerName(serverName)).toThrow(
      'should not contain the delimiter',
    )
  })

  it('rejects malformed tool names', () => {
    // Given: a tool name that does not include the server/tool delimiter.
    const malformedToolName = 'filesystem'

    // When/Then: parsing fails closed with the typed invalid-name exception.
    expect(() => parseToolName(malformedToolName)).toThrow(
      InvalidToolNameException,
    )
  })

  it('roundtrips valid tool names', () => {
    // Given: a valid server and tool name pair.
    const combinedName = getToolName('github', 'search')

    // When: the combined name is parsed.
    const parsed = parseToolName(combinedName)

    // Then: the original server and tool names are recovered.
    expect(parsed).toEqual({
      serverName: 'github',
      toolName: 'search',
    })
  })
})
