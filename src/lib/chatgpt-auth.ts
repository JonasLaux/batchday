import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createRemoteJWKSet, jwtVerify } from 'jose'

const issuer = 'https://auth.openai.com'
const resource = 'https://api.openai.com/v1'
const tokenEndpoint = `${issuer}/api/accounts/oauth/token`
const planScope = 'chatgpt.tokens.use.direct'
const connectMessage = 'Connect your ChatGPT account with pnpm chatgpt:login on the server.'
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))

type Credentials = {
  issuer: string
  client_id: string
  subject: string
  email: string | null
  access_token?: string
  refresh_token?: string
  id_token?: string
  expires_at?: number
  scopes?: string[]
}

const authDir = () => resolve(process.env.BATCHDAY_AUTH_DIR || join(homedir(), '.config/batchday'))
const credentialsPath = () => join(authDir(), 'chatgpt.json')
const pendingPath = () => join(authDir(), 'pending-registration.json')

async function prepareDirectory() {
  await mkdir(authDir(), { recursive: true, mode: 0o700 })
  await chmod(authDir(), 0o700)
}

async function writeJSON(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' })
    await rename(temp, path)
  } finally {
    await rm(temp, { force: true })
  }
}

async function readCredentials(): Promise<Credentials | null> {
  try {
    const value = JSON.parse(await readFile(credentialsPath(), 'utf8')) as Credentials
    if (!value || value.issuer !== issuer || typeof value.client_id !== 'string' || !value.client_id
      || value.client_id === 'dynamic_agent_client' || typeof value.subject !== 'string' || !value.subject
      || (value.email !== null && typeof value.email !== 'string')) throw new Error('invalid')
    if (value.access_token !== undefined && (typeof value.access_token !== 'string' || !value.access_token
      || typeof value.refresh_token !== 'string' || !value.refresh_token
      || !Number.isFinite(value.expires_at) || !Array.isArray(value.scopes)
      || !value.scopes.every((scope) => typeof scope === 'string'))) throw new Error('invalid')
    await chmod(credentialsPath(), 0o600)
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error(`ChatGPT credentials could not be read. ${connectMessage}`)
  }
}

async function withAuthLock<T>(operation: () => Promise<T>): Promise<T> {
  await prepareDirectory()
  const lock = join(authDir(), 'session.lock')
  // Cover refresh plus JWKS verification (25s) and both logout attempts (40.25s).
  const deadline = Date.now() + 45_000
  while (true) {
    try {
      await mkdir(lock, { mode: 0o700 })
      await writeFile(join(lock, 'pid'), String(process.pid), { mode: 0o600 })
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      // Never delete a lock by age: another process may own a newly replaced session.
      if (Date.now() >= deadline) throw new Error(`ChatGPT sign-in is busy. Try again, or stop Batchday before removing a stale lock at ${lock}.`)
      await delay(50)
    }
  }
  try { return await operation() } finally { await rm(lock, { recursive: true, force: true }) }
}

async function hostId() {
  const path = join(authDir(), 'host-id.json')
  try {
    const id: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (typeof id !== 'string' || !/^urn:uuid:[0-9a-f-]{36}$/i.test(id)) throw new Error('invalid')
    return id
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Batchday host ID could not be read.')
    const id = `urn:uuid:${randomUUID()}`
    await writeJSON(path, id)
    return id
  }
}

async function requestTokens(body: URLSearchParams): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(tokenEndpoint, {
      method: 'POST', body, signal: AbortSignal.timeout(20_000), redirect: 'error',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    })
  } catch { throw new Error('ChatGPT authentication is unavailable. Please try again.') }
  if (!response.ok) throw new Error(`ChatGPT authorization failed (${response.status}). ${connectMessage}`)
  try {
    const value: unknown = await response.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    return value as Record<string, unknown>
  } catch { throw new Error('ChatGPT returned an invalid token response.') }
}

function tokenSet(tokens: Record<string, unknown>, previous?: Credentials) {
  const scopes = typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/).filter(Boolean) : previous?.scopes
  if (!scopes?.includes(planScope)) throw new Error('ChatGPT plan access was not granted. Allow plan usage when connecting Batchday.')
  const expiresAt = typeof tokens.expires_in === 'number' ? Date.now() + tokens.expires_in * 1000 : NaN
  if (typeof tokens.access_token !== 'string' || !tokens.access_token
    || typeof tokens.refresh_token !== 'string' || !tokens.refresh_token
    || typeof tokens.expires_in !== 'number' || tokens.expires_in <= 0 || !Number.isFinite(expiresAt)
    || typeof tokens.token_type !== 'string' || tokens.token_type.toLowerCase() !== 'bearer') {
    throw new Error('ChatGPT returned an invalid token response.')
  }
  return {
    access_token: tokens.access_token, refresh_token: tokens.refresh_token,
    expires_at: expiresAt, scopes,
    ...(typeof tokens.id_token === 'string' ? { id_token: tokens.id_token } : {}),
  }
}

async function verifyIdentity(idToken: string, clientId: string, nonce?: string) {
  try {
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer, audience: clientId, requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5,
    })
    if (typeof payload.sub !== 'string' || !payload.sub || (nonce !== undefined && payload.nonce !== nonce)) throw new Error('invalid identity')
    return { subject: payload.sub, email: typeof payload.email === 'string' ? payload.email : null }
  } catch { throw new Error('ChatGPT identity could not be verified. Please connect again.') }
}

export async function getChatGPTAccessToken(): Promise<string> {
  return withAuthLock(async () => {
    const saved = await readCredentials()
    if (!saved?.access_token || !saved.refresh_token || !saved.scopes?.includes(planScope)) throw new Error(connectMessage)
    if (saved.expires_at! > Date.now() + 60_000) return saved.access_token
    const tokens = await requestTokens(new URLSearchParams({
      grant_type: 'refresh_token', client_id: saved.client_id, refresh_token: saved.refresh_token, resource,
    }))
    const renewed = tokenSet(tokens, saved)
    if (renewed.id_token) {
      const identity = await verifyIdentity(renewed.id_token, saved.client_id)
      if (identity.subject !== saved.subject) throw new Error('ChatGPT account changed during refresh. Please connect again.')
    }
    await writeJSON(credentialsPath(), { ...saved, ...renewed })
    return renewed.access_token
  })
}

export async function getChatGPTAccount(): Promise<{ email: string | null } | null> {
  try {
    const saved = await readCredentials()
    return saved?.access_token && saved.scopes?.includes(planScope) ? { email: saved.email } : null
  } catch { return null }
}

export async function loginChatGPT(onReady: (authorizationUrl: string, callbackUrl: string) => void, newAccount = false) {
  const { saved, host, pendingClient } = await withAuthLock(async () => {
    let pendingClient: string | undefined
    try {
      const pending: unknown = JSON.parse(await readFile(pendingPath(), 'utf8'))
      if (!pending || typeof pending !== 'object' || !('client_id' in pending)
        || typeof pending.client_id !== 'string' || !pending.client_id || pending.client_id === 'dynamic_agent_client') throw new Error('invalid')
      pendingClient = pending.client_id
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Pending ChatGPT registration could not be read. Remove ${pendingPath()} to start again.`)
    }
    return { saved: await readCredentials(), host: await hostId(), pendingClient }
  })
  const selected = newAccount ? null : saved
  const registrationClient = newAccount ? undefined : selected?.client_id || pendingClient
  const state = randomBytes(32).toString('base64url')
  const nonce = randomBytes(32).toString('base64url')
  const verifier = randomBytes(64).toString('base64url')
  let callbackUrl = ''
  let consumed = false
  let finish: (value: { code: string; clientId: string }) => void
  let fail: (error: Error) => void
  const callback = new Promise<{ code: string; clientId: string }>((resolve, reject) => { finish = resolve; fail = reject })
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', 'text/plain; charset=utf-8')
    const url = new URL(request.url || '/', callbackUrl)
    if (request.method !== 'GET' || url.pathname !== '/auth/callback' || request.headers.host !== new URL(callbackUrl).host) {
      response.writeHead(404).end('Not found.'); return
    }
    const returnedState = url.searchParams.get('state') || ''
    if (consumed || url.searchParams.getAll('state').length !== 1 || Buffer.byteLength(returnedState) !== Buffer.byteLength(state)
      || !timingSafeEqual(Buffer.from(returnedState), Buffer.from(state))) {
      response.writeHead(400).end('Sign-in could not be verified.'); return
    }
    consumed = true
    const code = url.searchParams.get('code')
    const clientId = url.searchParams.get('client_id') || registrationClient
    if (url.searchParams.has('error') || !code || url.searchParams.getAll('code').length !== 1
      || !clientId || clientId === 'dynamic_agent_client' || (registrationClient && clientId !== registrationClient)
      || url.searchParams.getAll('client_id').length > 1) {
      response.writeHead(400).end('Sign-in was not completed. Return to the terminal and try again.')
      fail(new Error('ChatGPT sign-in was declined or incomplete. Your previous connection was kept.')); return
    }
    response.end('ChatGPT sign-in received. Return to the Batchday terminal to finish connecting.')
    finish({ code, clientId })
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Could not start the ChatGPT sign-in callback.')
    callbackUrl = `http://127.0.0.1:${address.port}/auth/callback`
    const authorization = new URL(`${issuer}/api/accounts/authorize`)
    authorization.search = new URLSearchParams({
      client_id: registrationClient || 'dynamic_agent_client',
      ...(registrationClient ? {} : { agent_name_hint: 'Batchday' }), ext_agent_host_id: host,
      response_type: 'code', redirect_uri: callbackUrl,
      scope: `openid profile email offline_access resource.invoke ${planScope}`, resource, state, nonce,
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    }).toString()
    timer = setTimeout(() => fail(new Error('ChatGPT sign-in timed out. Please run pnpm chatgpt:login again.')), 300_000)
    onReady(authorization.toString(), callbackUrl)
    const { code, clientId } = await callback
    if (!selected) await withAuthLock(() => writeJSON(pendingPath(), { client_id: clientId }))
    const tokens = await requestTokens(new URLSearchParams({
      grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier,
      redirect_uri: callbackUrl, resource,
    }))
    const fresh = tokenSet(tokens)
    if (!fresh.id_token) throw new Error('ChatGPT returned no identity token. Your previous connection was kept.')
    const identity = await verifyIdentity(fresh.id_token, clientId, nonce)
    if (selected && identity.subject !== selected.subject) throw new Error('A different ChatGPT account was selected. Use --new-account to switch accounts.')
    await withAuthLock(async () => {
      await writeJSON(credentialsPath(), { issuer, client_id: clientId, ...identity, ...fresh })
      if (!selected) await rm(pendingPath(), { force: true })
    })
    return identity
  } finally {
    clearTimeout(timer)
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

export async function logoutChatGPT(): Promise<boolean> {
  return withAuthLock(async () => {
    const saved = await readCredentials()
    if (!saved?.refresh_token) return true
    let revoked = false
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const discovery = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000), redirect: 'error' })
        if (!discovery.ok) throw new Error('unavailable')
        const config = await discovery.json() as { revocation_endpoint?: unknown }
        if (typeof config.revocation_endpoint !== 'string' || new URL(config.revocation_endpoint).origin !== issuer) throw new Error('invalid endpoint')
        const response = await fetch(config.revocation_endpoint, {
          method: 'POST', signal: AbortSignal.timeout(10_000), redirect: 'error',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: saved.refresh_token, token_type_hint: 'refresh_token', client_id: saved.client_id }),
        })
        revoked = response.status === 200
        if (revoked || response.status < 500) break
      } catch { /* Keep tokens available until the retry, then clear them locally. */ }
      if (attempt === 0) await delay(250)
    }
    await writeJSON(credentialsPath(), { issuer, client_id: saved.client_id, subject: saved.subject, email: saved.email })
    return revoked
  })
}
