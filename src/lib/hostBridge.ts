export type HostSaveStatus = 'saved' | 'pending' | 'error'

type OutboundMessage =
  | { type: 'save-status'; status: HostSaveStatus }
  | { type: 'unauthorized' }

interface HostCallbacks {
  sessionRestored: () => void
  sessionLost: (reason?: string) => void
  openPublish: () => void
}

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        guano?: { postMessage: (message: unknown) => void }
      }
    }
    __guanoHost?: HostCallbacks
  }
}

const REAUTH_TIMEOUT_MS = 10_000

const channel = () =>
  typeof window === 'undefined' ? undefined : window.webkit?.messageHandlers?.guano

let pending: { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } | null =
  null
let timer: ReturnType<typeof setTimeout> | null = null

function settle(fn: (p: NonNullable<typeof pending>) => void) {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const current = pending
  pending = null
  if (current) fn(current)
}

function post(message: OutboundMessage): void {
  channel()?.postMessage(message)
}

function requestReauth(): Promise<void> {
  if (pending) return pending.promise
  if (!channel()) return Promise.reject(new Error('no host'))

  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  pending = { promise, resolve, reject }

  timer = setTimeout(() => {
    const current = pending
    pending = null
    timer = null
    current?.reject(new Error('the app did not answer'))
  }, REAUTH_TIMEOUT_MS)

  post({ type: 'unauthorized' })
  return promise
}

export const hostBridge = {
  get available(): boolean {
    return !!channel()
  },
  post,
  requestReauth,
}

export function installHostCallbacks(openPublish: () => void): void {
  if (!channel()) return
  window.__guanoHost = {
    sessionRestored: () => settle((p) => p.resolve()),
    sessionLost: (reason?: string) =>
      settle((p) => p.reject(new Error(reason || 'the session could not be restored'))),
    openPublish,
  }
}
