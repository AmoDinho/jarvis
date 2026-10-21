import { takeSentences } from '../shared/speech.ts'
import type { Tool } from './tools.ts'

export type ClaudeBlock = {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  thinking?: string
  signature?: string
}

export type ClaudeTurn = {
  stopReason: string | null
  blocks: ClaudeBlock[]
  text: string
  toolUses: { id: string; name: string; input: unknown }[]
  usage: { inputTokens: number; outputTokens: number }
}

type StreamHooks = {
  onSentence?: (text: string) => void
  onPartial?: (text: string) => void
}

let thinkingDisabled: boolean | null = null

export async function claudeTurn(input: {
  apiKey: string
  model: string
  system: string
  messages: unknown[]
  tools: Tool[]
  maxTokens?: number
  signal?: AbortSignal
  hooks?: StreamHooks
}): Promise<ClaudeTurn> {
  const body: Record<string, unknown> = {
    model: input.model,
    max_tokens: input.maxTokens ?? 2048,
    system: input.system,
    messages: input.messages,
    tools: input.tools,
    stream: true,
  }
  if (thinkingDisabled !== false) body.thinking = { type: 'disabled' }
  let response = await post(input.apiKey, body, input.signal)
  if (response.status === 400 && body.thinking) {
    const errText = await response.text()
    if (/thinking|temperature|top_p/i.test(errText)) {
      thinkingDisabled = false
      delete body.thinking
      response = await post(input.apiKey, body, input.signal)
    } else {
      throw new Error(trimError(errText))
    }
  }
  if (!response.ok) throw new Error(trimError(await response.text()))
  thinkingDisabled = body.thinking ? true : false
  return readStream(response, input.hooks)
}

async function post(apiKey: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
}

async function readStream(response: Response, hooks?: StreamHooks): Promise<ClaudeTurn> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Claude returned an empty stream.')
  const decoder = new TextDecoder()
  let buffer = ''
  const blocks: ClaudeBlock[] = []
  let stopReason: string | null = null
  let usage = { inputTokens: 0, outputTokens: 0 }
  let speechBuffer = ''
  let event = ''
  let data = ''

  const handle = () => {
    if (!data) return
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(data) as Record<string, unknown>
    } catch {
      return
    }
    const type = String(parsed.type ?? event)
    if (type === 'error') {
      const err = parsed.error as { message?: string } | undefined
      throw new Error(err?.message ?? 'Claude stream error')
    }
    if (type === 'message_start') {
      const message = parsed.message as { usage?: { input_tokens?: number; output_tokens?: number } } | undefined
      usage.inputTokens += message?.usage?.input_tokens ?? 0
      usage.outputTokens += message?.usage?.output_tokens ?? 0
    }
    if (type === 'content_block_start') {
      const block = (parsed.content_block ?? {}) as ClaudeBlock
      blocks[Number(parsed.index)] = { ...block, input: block.type === 'tool_use' ? '' : block.input }
    }
    if (type === 'content_block_delta') {
      const index = Number(parsed.index)
      const delta = parsed.delta as { type?: string; text?: string; partial_json?: string; thinking?: string; signature?: string }
      const block = blocks[index] ?? { type: 'text' }
      if (delta.type === 'text_delta' && delta.text) {
        block.text = `${block.text ?? ''}${delta.text}`
        speechBuffer += delta.text
        hooks?.onPartial?.(speechBuffer)
        const taken = takeSentences(speechBuffer)
        speechBuffer = taken.rest
        for (const sentence of taken.sentences) hooks?.onSentence?.(sentence)
      }
      if (delta.type === 'input_json_delta' && delta.partial_json) {
        block.input = `${typeof block.input === 'string' ? block.input : ''}${delta.partial_json}`
      }
      if (delta.type === 'thinking_delta' && delta.thinking) block.thinking = `${block.thinking ?? ''}${delta.thinking}`
      if (delta.type === 'signature_delta' && delta.signature) block.signature = `${block.signature ?? ''}${delta.signature}`
      blocks[index] = block
    }
    if (type === 'message_delta') {
      const delta = parsed.delta as { stop_reason?: string } | undefined
      if (delta?.stop_reason) stopReason = delta.stop_reason
      const used = parsed.usage as { output_tokens?: number; input_tokens?: number } | undefined
      if (used?.output_tokens) usage.outputTokens = used.output_tokens
      if (used?.input_tokens) usage.inputTokens = used.input_tokens
    }
  }

  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    for (const line of parts) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data += line.slice(5).trim()
      else if (line.trim() === '') {
        handle()
        event = ''
        data = ''
      }
    }
  }
  const flushed = takeSentences(speechBuffer, true)
  for (const sentence of flushed.sentences) hooks?.onSentence?.(sentence)

  const toolUses = blocks
    .filter((block) => block?.type === 'tool_use')
    .map((block) => ({
      id: block.id ?? '',
      name: block.name ?? '',
      input: parseInput(block.input),
    }))
  const text = blocks
    .filter((block) => block?.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim()
  return { stopReason, blocks: blocks.filter(Boolean), text, toolUses, usage }
}

function parseInput(input: unknown): unknown {
  if (typeof input !== 'string') return input ?? {}
  if (!input.trim()) return {}
  try {
    return JSON.parse(input)
  } catch {
    return {}
  }
}

function trimError(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } }
    return parsed.error?.message ?? text.slice(0, 400)
  } catch {
    return text.slice(0, 400)
  }
}
