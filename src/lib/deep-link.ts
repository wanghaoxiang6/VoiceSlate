import { onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { useAuthStore } from '../stores/authStore'

/** Pending OAuth state for CSRF validation. */
let pendingOAuthState: string | null = null
let pendingOAuthTimer: ReturnType<typeof setTimeout> | null = null

/** Generate and store a random state string for OAuth CSRF protection. */
export function generateOAuthState(): string {
  clearOAuthState()
  const state = crypto.randomUUID()
  pendingOAuthState = state
  // Auto-expire after 5 minutes to prevent stale state
  pendingOAuthTimer = setTimeout(clearOAuthState, 5 * 60 * 1000)
  return state
}

/** Clear pending OAuth state (e.g. user cancelled or timed out). */
export function clearOAuthState(): void {
  pendingOAuthState = null
  if (pendingOAuthTimer) {
    clearTimeout(pendingOAuthTimer)
    pendingOAuthTimer = null
  }
}

export async function initDeepLinkListener() {
  try {
    await onOpenUrl(async (urls) => {
      for (const rawUrl of urls) {
        await handleDeepLinkUrl(rawUrl)
      }
    })
  } catch {
    // Deep link plugin not available (e.g. web dev mode)
  }
}

/** Basic sanity check: token must be a non-empty alphanumeric/JWT-like string. */
function isValidToken(token: string): boolean {
  return /^[\w\-._~+/]+=*$/.test(token) && token.length >= 10 && token.length <= 4096
}

async function handleDeepLinkUrl(rawUrl: string) {
  console.log('[deep-link] received URL:', rawUrl.replace(/token=[^&]+/, 'token=***'))
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return
  }

  // Only accept our custom scheme
  if (url.protocol !== 'voiceslate:') return

  const path = url.hostname + url.pathname
  const params = url.searchParams

  // voiceslate://auth/callback?token=xxx&state=yyy
  if (path === 'auth/callback' || path === 'auth/callback/') {
    const token = params.get('token')
    const state = params.get('state')

    // Reject tokens when no OAuth flow was initiated (prevents external injection)
    if (!pendingOAuthState) {
      return
    }
    // Validate CSRF state
    if (state !== pendingOAuthState) {
      pendingOAuthState = null
      return
    }
    pendingOAuthState = null

    if (token && isValidToken(token)) {
      await useAuthStore.getState().handleDeepLinkToken(token)
      window.location.hash = '#/account'
    }
    return
  }

  // voiceslate://checkout/success
  if (path === 'checkout/success' || path === 'checkout/success/') {
    await useAuthStore.getState().refreshSubscription()
    window.location.hash = '#/upgrade'
    return
  }
}
