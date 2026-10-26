import { getChatGPTAccessToken } from './chatgpt-auth.ts'

export class ChatGPTError extends Error {}

function requestError(status: number, code?: string): ChatGPTError {
  if (code?.startsWith('subscription_sharing_usage_') || status === 429) {
    return new ChatGPTError('ChatGPT usage is unavailable or its limit has been reached. Review your plan and app limits in ChatGPT Settings → Usage.')
  }
  if (status === 401 || status === 403) {
    return new ChatGPTError('Your ChatGPT connection needs attention. Reconnect with pnpm chatgpt:login on the server and allow ChatGPT plan usage.')
  }
  return new ChatGPTError(`ChatGPT could not generate a recipe (${status}). Please try again.`)
}

type CompletedResponse = {
  status: string
  model: string
  output: { type: string; content?: { type: string; text?: string }[] }[]
}

// A streamed response can fail after text arrives; only the terminal completion is safe to save.
export async function readRecipeResponse(response: Response): Promise<{ output: unknown; model: string }> {
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw requestError(response.status, typeof body?.error?.code === 'string' ? body.error.code : undefined)
  }
  if (!response.body) throw new ChatGPTError('ChatGPT returned an empty response. Please try again.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let bytes = 0
  let streamedText = ''
  const parseEvent = (frame: string): { output: unknown; model: string } | undefined => {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
    if (!data || data === '[DONE]') return
    const event = JSON.parse(data)
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') streamedText += event.delta
    if (event.type === 'response.refusal.delta' || event.type === 'response.refusal.done') {
      throw new ChatGPTError('ChatGPT could not fulfill that recipe request. Try a different description.')
    }
    if (event.type === 'response.failed' || event.type === 'error') {
      throw requestError(502, event.response?.error?.code ?? event.error?.code ?? event.code)
    }
    if (event.type === 'response.incomplete') throw new ChatGPTError('ChatGPT did not finish the recipe. Please try again.')
    if (event.type !== 'response.completed') return
    const result = event.response as CompletedResponse | undefined
    if (result?.status !== 'completed' || !Array.isArray(result.output) || typeof result.model !== 'string') {
      throw new ChatGPTError('ChatGPT returned an invalid completion. Please try again.')
    }
    const content = result.output.filter((item) => item.type === 'message').flatMap((item) => item.content ?? [])
    if (content.some((item) => item.type === 'refusal')) throw new ChatGPTError('ChatGPT could not fulfill that recipe request. Try a different description.')
    const text = content.filter((item) => item.type === 'output_text').map((item) => item.text ?? '').join('') || streamedText
    if (!text) throw new ChatGPTError('ChatGPT returned no recipe. Please try again.')
    return { output: JSON.parse(text) as unknown, model: result.model }
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        pending += decoder.decode()
        if (pending.trim()) {
          const result = parseEvent(pending)
          if (result) return result
        }
        throw new ChatGPTError('The ChatGPT connection ended before the recipe was complete. Please try again.')
      }
      bytes += value.byteLength
      if (bytes > 4_000_000) throw new ChatGPTError('ChatGPT returned too much data. Try a simpler recipe request.')
      pending += decoder.decode(value, { stream: true })
      let separator: RegExpExecArray | null
      while ((separator = /\r?\n\r?\n/.exec(pending))) {
        const frame = pending.slice(0, separator.index)
        pending = pending.slice(separator.index + separator[0].length)
        const result = parseEvent(frame)
        if (result) return result
      }
    }
  } catch (error) {
    if (error instanceof ChatGPTError) throw error
    throw new ChatGPTError('The ChatGPT response could not be read. Please try again.')
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function generateChatGPTRecipe(instructions: string, request: string, schema: object) {
  try {
    const token = await getChatGPTAccessToken().catch(() => {
      throw new ChatGPTError('Your ChatGPT connection needs attention. Run pnpm chatgpt:login on the server.')
    })
    const signal = AbortSignal.timeout(120_000)
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const catalog = await fetch('https://api.openai.com/v1/models', { headers, signal, redirect: 'error' })
    if (!catalog.ok) throw requestError(catalog.status)
    const { models } = await catalog.json() as { models?: { slug: string; visibility: string; supported_reasoning_levels?: { effort?: string }[] }[] }
    const available = Array.isArray(models) ? models.filter((model) => model.visibility === 'list' && typeof model.slug === 'string' && model.slug) : []
    // Luna at max reasoning is the default; plans without Luna fall back to their first listed model.
    const model = process.env.BATCHDAY_MODEL || (available.some((item) => item.slug === 'gpt-6-luna') ? 'gpt-6-luna' : available[0]?.slug)
    const chosen = available.find((item) => item.slug === model)
    if (!model || !chosen) {
      throw new ChatGPTError('The selected model is unavailable for your ChatGPT account. Check BATCHDAY_MODEL or your ChatGPT plan access.')
    }
    return await readRecipeResponse(await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers, signal, redirect: 'error',
      body: JSON.stringify({
        model, instructions, input: [{ role: 'user', content: request }], store: false, stream: true,
        ...(Array.isArray(chosen.supported_reasoning_levels) && chosen.supported_reasoning_levels.some((level) => level?.effort === 'max') && { reasoning: { effort: 'max' } }),
        text: { format: { type: 'json_schema', name: 'recipe', strict: true, schema } },
      }),
    }))
  } catch (error) {
    if (error instanceof ChatGPTError) throw error
    throw new ChatGPTError('ChatGPT could not be reached or the request timed out. Please try again.')
  }
}
