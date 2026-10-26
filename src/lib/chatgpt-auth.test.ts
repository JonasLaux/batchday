import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { getChatGPTAccessToken, getChatGPTAccount, loginChatGPT, logoutChatGPT } from './chatgpt-auth.ts'

const realFetch = globalThis.fetch
const issuer = 'https://auth.openai.com'
const { privateKey, publicKey } = await generateKeyPair('RS256')
const publicJWK = { ...await exportJWK(publicKey), kid: 'auth-test', alg: 'RS256' }
const freshCredentials = () => ({
  issuer, client_id: 'oaiapp_test', subject: 'test-user', email: 'cook@example.com',
  access_token: 'old-access', refresh_token: 'old-refresh', expires_at: Date.now() + 3_600_000,
  scopes: ['openid', 'offline_access', 'chatgpt.tokens.use.direct'],
})

async function isolated(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'batchday-auth-test-'))
  const previousDirectory = process.env.BATCHDAY_AUTH_DIR
  process.env.BATCHDAY_AUTH_DIR = directory
  try { await run(directory) } finally {
    globalThis.fetch = realFetch
    if (previousDirectory === undefined) delete process.env.BATCHDAY_AUTH_DIR
    else process.env.BATCHDAY_AUTH_DIR = previousDirectory
    await rm(directory, { recursive: true, force: true })
  }
}

const readSaved = async (directory: string) => JSON.parse(await readFile(join(directory, 'chatgpt.json'), 'utf8'))
const save = (directory: string, value: unknown) => writeFile(join(directory, 'chatgpt.json'), JSON.stringify(value))
const grant = (overrides: Record<string, unknown> = {}) => ({
  access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, token_type: 'Bearer',
  scope: 'openid offline_access chatgpt.tokens.use.direct', ...overrides,
})

async function identity(nonce: string, options: { subject?: string; audience?: string; nonce?: string; expired?: boolean } = {}) {
  return new SignJWT({ nonce: options.nonce ?? nonce, email: 'cook@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'auth-test' }).setIssuer(issuer)
    .setSubject(options.subject ?? 'test-user').setAudience(options.audience ?? 'oaiapp_test')
    .setIssuedAt().setExpirationTime(options.expired ? Math.floor(Date.now() / 1000) - 60 : '5m').sign(privateKey)
}

async function login(options: {
  newAccount?: boolean
  denied?: boolean
  wrongStateFirst?: boolean
  tokenOverrides?: Record<string, unknown>
  identityOptions?: Parameters<typeof identity>[1]
  onAuthorization?: (url: URL) => void
  tokenStatus?: number
} = {}) {
  let authorization: URL
  let callbackTask: Promise<void> | undefined
  let tokenCalls = 0
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [publicJWK] })
    assert.equal(url, `${issuer}/api/accounts/oauth/token`)
    tokenCalls++
    const body = init?.body as URLSearchParams
    assert.equal(body.get('client_id'), 'oaiapp_test')
    assert.equal(body.get('grant_type'), 'authorization_code')
    assert.equal(body.get('code'), 'authorization-code')
    assert.equal(body.get('resource'), 'https://api.openai.com/v1')
    assert.equal(body.get('redirect_uri'), authorization.searchParams.get('redirect_uri'))
    assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'), authorization.searchParams.get('code_challenge'))
    if (options.tokenStatus) return Response.json({ error: 'invalid_grant' }, { status: options.tokenStatus })
    return Response.json(grant({ id_token: await identity(authorization.searchParams.get('nonce')!, options.identityOptions), ...options.tokenOverrides }))
  }
  const pending = loginChatGPT((url, callback) => {
    authorization = new URL(url)
    options.onAuthorization?.(authorization)
    callbackTask = (async () => {
      if (options.wrongStateFirst) {
        const bad = new URL(callback)
        bad.search = new URLSearchParams({ state: 'å'.repeat(43), code: 'bad' }).toString()
        assert.equal((await realFetch(bad)).status, 400)
      }
      const returned = new URL(callback)
      returned.search = new URLSearchParams({ state: authorization.searchParams.get('state')!,
        ...(options.denied ? { error: 'access_denied' } : { code: 'authorization-code', client_id: 'oaiapp_test' }),
      }).toString()
      assert.equal((await realFetch(returned)).status, options.denied ? 400 : 200)
    })()
  }, options.newAccount)
  try { return await pending } finally {
    await callbackTask
    if (options.denied) assert.equal(tokenCalls, 0)
  }
}

test('missing credentials need account setup and expose no account', () => isolated(async (directory) => {
  globalThis.fetch = async () => { throw new Error('must not request') }
  assert.equal(await getChatGPTAccount(), null)
  await assert.rejects(getChatGPTAccessToken(), /pnpm chatgpt:login/)
  assert.equal((await stat(directory)).mode & 0o777, 0o700)
}))

test('fresh credentials return their token without network and expose only email', () => isolated(async (directory) => {
  await save(directory, freshCredentials())
  globalThis.fetch = async () => { throw new Error('must not request') }
  assert.equal(await getChatGPTAccessToken(), 'old-access')
  assert.deepEqual(await getChatGPTAccount(), { email: 'cook@example.com' })
  assert.equal((await stat(join(directory, 'chatgpt.json'))).mode & 0o777, 0o600)
}))

test('concurrent expired sessions refresh once and atomically persist replacement tokens', () => isolated(async (directory) => {
  await save(directory, { ...freshCredentials(), expires_at: 0 })
  let requests = 0
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), `${issuer}/api/accounts/oauth/token`)
    const body = init?.body as URLSearchParams
    assert.equal(body.get('grant_type'), 'refresh_token')
    assert.equal(body.get('refresh_token'), 'old-refresh')
    assert.equal(body.get('client_id'), 'oaiapp_test')
    assert.equal(body.has('scope'), false)
    requests++
    await new Promise((resolve) => setTimeout(resolve, 30))
    return Response.json(grant())
  }
  assert.deepEqual(await Promise.all([getChatGPTAccessToken(), getChatGPTAccessToken(), getChatGPTAccessToken()]), ['new-access', 'new-access', 'new-access'])
  assert.equal(requests, 1)
  const saved = await readSaved(directory)
  assert.equal(saved.refresh_token, 'new-refresh')
  assert.ok(saved.expires_at > Date.now() + 3_500_000)
  assert.equal((await stat(join(directory, 'chatgpt.json'))).mode & 0o777, 0o600)
}))

test('upstream refresh errors preserve the previous session without leaking response bodies', () => isolated(async (directory) => {
  const saved = { ...freshCredentials(), expires_at: 0 }
  await save(directory, saved)
  globalThis.fetch = async () => new Response('secret-access-token', { status: 401 })
  await assert.rejects(getChatGPTAccessToken(), (error: Error) => /401/.test(error.message) && !error.message.includes('secret'))
  assert.deepEqual(await readSaved(directory), saved)
}))

test('refresh rejects incomplete grants and removed plan permission while preserving credentials', () => isolated(async (directory) => {
  const saved = { ...freshCredentials(), expires_at: 0 }
  await save(directory, saved)
  for (const change of [{ refresh_token: '' }, { expires_in: -1 }, { token_type: 'Basic' }, { scope: 'openid email' }]) {
    globalThis.fetch = async () => Response.json(grant(change))
    await assert.rejects(getChatGPTAccessToken())
    assert.deepEqual(await readSaved(directory), saved)
  }
}))

test('first login validates PKCE and signed identity, ignores bad state, and protects local files', () => isolated(async (directory) => {
  await login({ wrongStateFirst: true, onAuthorization: (url) => {
    assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client')
    assert.equal(url.searchParams.get('agent_name_hint'), 'Batchday')
    assert.match(url.searchParams.get('ext_agent_host_id')!, /^urn:uuid:/)
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(url.searchParams.has('id_token_hint'), false)
  } })
  assert.equal(await getChatGPTAccessToken(), 'new-access')
  assert.equal((await readSaved(directory)).subject, 'test-user')
  assert.equal((await stat(join(directory, 'chatgpt.json'))).mode & 0o777, 0o600)
  assert.equal((await stat(join(directory, 'host-id.json'))).mode & 0o777, 0o600)
}))

test('reauthorization reuses client and host without logging an ID token hint', () => isolated(async () => {
  let firstHost = ''
  await login({ onAuthorization: (url) => { firstHost = url.searchParams.get('ext_agent_host_id')! } })
  await login({ onAuthorization: (url) => {
    assert.equal(url.searchParams.get('ext_agent_host_id'), firstHost)
    assert.equal(url.searchParams.get('client_id'), 'oaiapp_test')
    assert.equal(url.searchParams.has('agent_name_hint'), false)
    assert.equal(url.searchParams.has('id_token_hint'), false)
  } })
}))

test('invalid nonce, audience, expiry and changed identity cannot overwrite a previous login', () => isolated(async (directory) => {
  const saved = freshCredentials()
  await save(directory, saved)
  for (const identityOptions of [{ nonce: 'wrong' }, { audience: 'different-app' }, { expired: true }, { subject: 'another-user' }]) {
    await assert.rejects(login({ identityOptions }))
    assert.deepEqual(await readSaved(directory), saved)
  }
}))

test('declined login and missing plan permission keep the previous connection', () => isolated(async (directory) => {
  const saved = freshCredentials()
  await save(directory, saved)
  await assert.rejects(login({ denied: true }), /declined/)
  assert.deepEqual(await readSaved(directory), saved)
  await assert.rejects(login({ tokenOverrides: { scope: 'openid email' } }), /plan access was not granted/)
  assert.deepEqual(await readSaved(directory), saved)
}))

test('explicit new-account login is verified before replacing the active registration', () => isolated(async (directory) => {
  await save(directory, freshCredentials())
  await login({ newAccount: true, identityOptions: { subject: 'different-user' }, onAuthorization: (url) => {
    assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client')
  } })
  assert.equal((await readSaved(directory)).subject, 'different-user')
}))

test('a failed first exchange retains the issued client ID for the next sign-in attempt', () => isolated(async (directory) => {
  await assert.rejects(login({ tokenStatus: 400 }), /authorization failed/)
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'pending-registration.json'), 'utf8')), { client_id: 'oaiapp_test' })
  assert.equal(await getChatGPTAccount(), null)
  await login({ onAuthorization: (url) => {
    assert.equal(url.searchParams.get('client_id'), 'oaiapp_test')
    assert.equal(url.searchParams.has('agent_name_hint'), false)
  } })
  await assert.rejects(readFile(join(directory, 'pending-registration.json')), { code: 'ENOENT' })
  assert.equal(await getChatGPTAccessToken(), 'new-access')
}))

test('a contending process never deletes another process lock, including stale locks', (context) => isolated(async (directory) => {
  await mkdir(join(directory, 'session.lock'))
  await writeFile(join(directory, 'session.lock/pid'), '999999999')
  let now = 0
  context.mock.method(Date, 'now', () => { now += 20_000; return now })
  try {
    await assert.rejects(getChatGPTAccessToken(), /stop Batchday before removing a stale lock/)
    assert.equal(await readFile(join(directory, 'session.lock/pid'), 'utf8'), '999999999')
  } finally { context.mock.restoreAll() }
}))

test('logout revokes the renewable session, clears tokens and retains the registered identity', () => isolated(async (directory) => {
  await save(directory, freshCredentials())
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('openid-configuration')) return Response.json({ revocation_endpoint: `${issuer}/revoke` })
    assert.equal(String(input), `${issuer}/revoke`)
    assert.equal((init?.body as URLSearchParams).get('token'), 'old-refresh')
    assert.equal((init?.body as URLSearchParams).get('client_id'), 'oaiapp_test')
    return new Response(null, { status: 200 })
  }
  assert.equal(await logoutChatGPT(), true)
  assert.equal(await getChatGPTAccount(), null)
  await assert.rejects(getChatGPTAccessToken(), /pnpm chatgpt:login/)
  assert.deepEqual(await readSaved(directory), { issuer, client_id: 'oaiapp_test', subject: 'test-user', email: 'cook@example.com' })
}))

test('logout refuses foreign revocation URLs and reports remote failure after clearing locally', () => isolated(async (directory) => {
  await save(directory, freshCredentials())
  globalThis.fetch = async (input) => {
    assert.equal(String(input), `${issuer}/.well-known/openid-configuration`)
    return Response.json({ revocation_endpoint: 'https://attacker.example/revoke' })
  }
  assert.equal(await logoutChatGPT(), false)
  assert.equal(await getChatGPTAccount(), null)
}))

test('corrupt credentials do not break account display or expose file contents', () => isolated(async (directory) => {
  await writeFile(join(directory, 'chatgpt.json'), 'secret-corrupt-json')
  assert.equal(await getChatGPTAccount(), null)
  await assert.rejects(getChatGPTAccessToken(), (error: Error) => /could not be read/.test(error.message) && !error.message.includes('secret'))
}))
