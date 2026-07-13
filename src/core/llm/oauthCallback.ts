import { redactSecrets } from '../../utils/security/redact-secrets'

export type OAuthCallbackDecision =
  | {
      readonly kind: 'not-found'
    }
  | {
      readonly kind: 'error'
      readonly statusCode: 400
      readonly responseBody: string
      readonly error: Error
      readonly terminal: boolean
    }
  | {
      readonly kind: 'success'
      readonly code: string
    }

type DecideOAuthCallbackParams = {
  readonly requestUrl: URL
  readonly expectedPath: string
  readonly expectedState: string
}

export function decideOAuthCallback(
  params: DecideOAuthCallbackParams,
): OAuthCallbackDecision {
  if (params.requestUrl.pathname !== params.expectedPath) {
    return { kind: 'not-found' }
  }

  const searchParams = params.requestUrl.searchParams
  const code = searchParams.get('code')
  const incomingState = searchParams.get('state')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  if (!incomingState) {
    return createErrorDecision({
      responseBody: 'Missing state parameter',
      errorMessage: 'Missing state parameter',
      terminal: false,
    })
  }

  if (incomingState !== params.expectedState) {
    return createErrorDecision({
      responseBody: 'Invalid state parameter',
      errorMessage: 'Invalid state parameter',
      terminal: false,
    })
  }

  if (error) {
    const errorMessage = sanitizeOAuthErrorText(errorDescription ?? error)
    return createErrorDecision({
      responseBody: `OAuth error: ${errorMessage}`,
      errorMessage,
      terminal: true,
    })
  }

  if (!code) {
    return createErrorDecision({
      responseBody: 'Missing authorization code',
      errorMessage: 'Missing authorization code',
      terminal: true,
    })
  }

  return {
    kind: 'success',
    code,
  }
}

function createErrorDecision(params: {
  readonly responseBody: string
  readonly errorMessage: string
  readonly terminal: boolean
}): OAuthCallbackDecision {
  return {
    kind: 'error',
    statusCode: 400,
    responseBody: params.responseBody,
    error: new Error(params.errorMessage),
    terminal: params.terminal,
  }
}

function sanitizeOAuthErrorText(value: string): string {
  return redactSecrets(value).replace(/[<>]/g, '')
}
