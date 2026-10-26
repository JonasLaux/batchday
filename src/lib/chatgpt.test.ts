import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { ChatGPTError, generateChatGPTRecipe, readRecipeResponse } from './chatgpt.ts'

const recipe = { title: 'Vegetable curry 🥕', ingredients: [{ name: 'Karotten', amount: 200 }] }
const completion = (overrides: Record<string, unknown> = {}) => ({
  type: 'response.completed',
  response: {
    status: 'completed', model: 'test-model',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(recipe) }] }],
    ...overrides,
  },
})
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`
const stream = (chunks: Uint8Array[]) => new Response(new ReadableStream<Uint8Array>({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk)
    controller.close()
  },
}))
const response = (...events: unknown[]) => stream([new TextEncoder().encode(events.map(frame).join(''))])
const safeError = (pattern: RegExp) => (error: unknown) => {
  assert.ok(error instanceof ChatGPTError)
  assert.match(error.message, pattern)
  assert.doesNotMatch(error.message, /private-token|secret-body/)
  return true
}

async function authenticate(t: TestContext) {
  const previousDir = process.env.BATCHDAY_AUTH_DIR
  const previousModel = process.env.BATCHDAY_MODEL
  const dir = await mkdtemp(join(tmpdir(), 'batchday-transport-'))
  process.env.BATCHDAY_AUTH_DIR = dir
  delete process.env.BATCHDAY_MODEL
  await writeFile(join(dir, 'chatgpt.json'), JSON.stringify({
    issuer: 'https://auth.openai.com', client_id: 'oaiapp_test', subject: 'test-user', email: 'test@example.com',
    access_token: 'private-token', refresh_token: 'refresh-test', expires_at: Date.now() + 3_600_000,
    scopes: ['chatgpt.tokens.use.direct'],
  }), { mode: 0o600 })
  t.after(async () => {
    if (previousDir === undefined) delete process.env.BATCHDAY_AUTH_DIR
    else process.env.BATCHDAY_AUTH_DIR = previousDir
    if (previousModel === undefined) delete process.env.BATCHDAY_MODEL
    else process.env.BATCHDAY_MODEL = previousModel
    await rm(dir, { recursive: true, force: true })
  })
}

test('reads terminal recipe JSON across split UTF-8, CRLF and multiline SSE data', async () => {
  const text = ': keepalive\r\n\r\n' +
    'event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta",\r\ndata: "delta":"partial"}\r\n\r\n' +
    frame(completion()).replaceAll('\n', '\r\n')
  const bytes = new TextEncoder().encode(text)
  const chunks = Array.from(bytes, (byte) => Uint8Array.of(byte))
  assert.deepEqual(await readRecipeResponse(stream(chunks)), { output: recipe, model: 'test-model' })
})

test('assembles streamed recipe deltas when the terminal completion has an empty output array', async () => {
  const json = JSON.stringify(recipe)
  const events = []
  for (let offset = 0; offset < json.length; offset += 11) {
    events.push({ type: 'response.output_text.delta', delta: json.slice(offset, offset + 11) })
  }
  events.push(completion({ output: [] }))
  const bytes = new TextEncoder().encode(events.map(frame).join(''))
  const chunks = []
  for (let offset = 0; offset < bytes.length; offset += 7) chunks.push(bytes.slice(offset, offset + 7))
  assert.deepEqual(await readRecipeResponse(stream(chunks)), { output: recipe, model: 'test-model' })
})

test('accepts a complete final SSE event at EOF and ignores DONE/keepalive frames', async () => {
  const bytes = new TextEncoder().encode(`: ping\n\ndata: [DONE]\n\n${frame(completion()).trimEnd()}`)
  assert.deepEqual(await readRecipeResponse(stream([bytes])), { output: recipe, model: 'test-model' })
})

test('rejects a partial response even when its text already looks like valid recipe JSON', async () => {
  await assert.rejects(readRecipeResponse(response({ type: 'response.output_text.delta', delta: JSON.stringify(recipe) })), safeError(/before the recipe was complete/))
  await assert.rejects(readRecipeResponse(response(
    { type: 'response.output_text.delta', delta: JSON.stringify(recipe) },
    { type: 'response.output_text.done', text: JSON.stringify(recipe) },
  )), safeError(/before the recipe was complete/))
})

test('rejects model refusals and incomplete completions', async () => {
  await assert.rejects(readRecipeResponse(response(completion({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'secret-body' }] }] }))), safeError(/different description/))
  await assert.rejects(readRecipeResponse(response({ type: 'response.incomplete', response: { incomplete_details: { reason: 'secret-body' } } })), safeError(/did not finish/))
})

test('rejects streamed refusals even after valid recipe deltas and an empty terminal output', async () => {
  for (const refusal of [
    { type: 'response.refusal.delta', delta: 'secret-body' },
    { type: 'response.refusal.done', refusal: 'secret-body' },
  ]) {
    await assert.rejects(readRecipeResponse(response(
      { type: 'response.output_text.delta', delta: JSON.stringify(recipe) },
      refusal,
      completion({ output: [] }),
    )), safeError(/different description/))
  }
})

test('reports subscription failures after streaming starts without exposing server data', async () => {
  for (const type of ['response.failed', 'error']) {
    const event = type === 'response.failed'
      ? { type, response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'private-token secret-body' } } }
      : { type, code: 'subscription_sharing_usage_unavailable', message: 'private-token secret-body' }
    await assert.rejects(readRecipeResponse(response({ type: 'response.output_text.delta', delta: JSON.stringify(recipe) }, event)), safeError(/ChatGPT Settings → Usage/))
  }
})

test('HTTP authentication and usage failures expose only actionable messages', async () => {
  for (const status of [401, 403, 429, 500]) {
    const pattern = status === 429 ? /usage/ : status === 500 ? /500/ : /Reconnect/
    await assert.rejects(readRecipeResponse(new Response(JSON.stringify({ error: { message: 'private-token secret-body' } }), { status })), safeError(pattern))
  }
  await assert.rejects(readRecipeResponse(new Response('private-token secret-body', { status: 502 })), safeError(/502/))
})

test('rejects malformed, empty or nonterminal responses', async () => {
  for (const event of [completion({ status: 'in_progress' }), completion({ model: null }), completion({ output: [] }), completion({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'secret-body' }] }] })]) {
    await assert.rejects(readRecipeResponse(response(event)), safeError(/invalid completion|no recipe|could not be read/))
  }
  await assert.rejects(readRecipeResponse(stream([new TextEncoder().encode('data: secret-body\n\n')])), safeError(/could not be read/))
  await assert.rejects(readRecipeResponse(new Response(null)), safeError(/empty response/))
})

test('caps streamed data and cancels the reader on failure', async () => {
  let cancelled = false
  const oversized = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(4_000_001)) },
    cancel() { cancelled = true },
  }))
  await assert.rejects(readRecipeResponse(oversized), safeError(/too much data/))
  assert.equal(cancelled, true)
})

test('cancels the reader after a completed recipe without waiting for the connection to close', async () => {
  let cancelled = false
  const completed = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode(frame(completion()))) },
    cancel() { cancelled = true },
  }))
  assert.deepEqual(await readRecipeResponse(completed), { output: recipe, model: 'test-model' })
  assert.equal(cancelled, true)
})

test('sends subscription OAuth, a strict recipe schema and no tools to the public Responses endpoint', async (t) => {
  await authenticate(t)
  const calls: { url: string; init?: RequestInit }[] = []
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.endsWith('/models')) return Response.json({ models: [{ slug: 'hidden', visibility: 'hide' }, { slug: 'test-model', visibility: 'list' }] })
    return response(completion())
  })
  const schema = { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string' } } }
  assert.deepEqual(await generateChatGPTRecipe('Write a recipe.', 'Curry', schema), { output: recipe, model: 'test-model' })
  assert.deepEqual(calls.map((call) => call.url), ['https://api.openai.com/v1/models', 'https://api.openai.com/v1/responses'])
  assert.equal(new Headers(calls[1].init?.headers).get('Authorization'), 'Bearer private-token')
  assert.equal(calls[1].init?.method, 'POST')
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), {
    model: 'test-model', instructions: 'Write a recipe.', input: [{ role: 'user', content: 'Curry' }],
    store: false, stream: true, text: { format: { type: 'json_schema', name: 'recipe', strict: true, schema } },
  })
})

test('prefers Luna and asks for max reasoning when the model offers it', async (t) => {
  await authenticate(t)
  const bodies: Record<string, unknown>[] = []
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith('/models')) return Response.json({ models: [{ slug: 'first', visibility: 'list' }, { slug: 'gpt-6-luna', visibility: 'list', supported_reasoning_levels: [{ effort: 'medium' }, { effort: 'max' }] }] })
    bodies.push(JSON.parse(String(init?.body)))
    return response(completion({ model: 'gpt-6-luna' }))
  })
  await generateChatGPTRecipe('Recipe.', 'Curry', {})
  assert.equal(bodies[0].model, 'gpt-6-luna')
  assert.deepEqual(bodies[0].reasoning, { effort: 'max' })
})

test('uses a configured available model and rejects unavailable models before generation', async (t) => {
  await authenticate(t)
  let generations = 0
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith('/models')) return Response.json({ models: [{ slug: 'first', visibility: 'list' }, { slug: 'chosen', visibility: 'list' }] })
    generations++
    assert.equal(JSON.parse(String(init?.body)).model, 'chosen')
    return response(completion({ model: 'chosen' }))
  })
  process.env.BATCHDAY_MODEL = 'chosen'
  assert.equal((await generateChatGPTRecipe('Recipe.', 'Curry', {})).model, 'chosen')
  process.env.BATCHDAY_MODEL = 'not-available'
  await assert.rejects(generateChatGPTRecipe('Recipe.', 'Curry', {}), safeError(/selected model is unavailable/))
  assert.equal(generations, 1)
})

test('turns transport failures into a safe message without exposing tokens or upstream bodies', async (t) => {
  await authenticate(t)
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('private-token secret-body') })
  await assert.rejects(generateChatGPTRecipe('Recipe.', 'Curry', {}), safeError(/could not be reached/))
})
