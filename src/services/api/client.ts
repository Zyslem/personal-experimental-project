import { translate, type TranslationMessage } from '../../i18n/index.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
} from './types.js'

/** 构建期 API 地址，改为了本地代理函数 */
export const API_ORIGIN = "/.netlify/functions/chat"
/** 因为后端会拼接 /anthropic/v1，前端这里的基础 URL 直接用 API_ORIGIN 即可 */
const ANTHROPIC_BASE_URL = `${API_ORIGIN}`
const FILES_BETA = 'files-api-2025-04-14'

export type ApiErrorKind =
  | 'http'
  | 'stream'
  | 'network'
  | 'interrupted'
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
    }
  } catch {}
  return new ApiError(kind, message, response.status)
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

const anthropicHeaders = (_apiKey: string, beta: boolean): Record<string, string> => ({
  'x-api-key': '', 
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  return Promise.resolve();
}

export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const form = new FormData()
  if (purpose) form.append('purpose', purpose)
  form.append('file', file)
  const response = await request(`${ANTHROPIC_BASE_URL}?path=/files`, {
    method: 'POST',
    headers: anthropicHeaders(apiKey, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

export const deleteFile = async (apiKey: string, fileId: string): Promise<void> => {
  await request(`${ANTHROPIC_BASE_URL}?path=/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(apiKey, true),
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

export async function* streamMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  // 请求 Edge Function 代理
  const response = await request(`${ANTHROPIC_BASE_URL}?path=/messages`, {
    method: 'POST',
    headers: {
      ...anthropicHeaders(apiKey, hasFile(body)),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream', // 重新开启接收流
    },
    // 强制要求后端返回流式数据
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
  
  // 检查响应头，确保是流
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  
  // 使用原来的流解析循环
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') continue
    }
    if (isErrorBody(payload)) throw new ApiError('stream', payload.error.message)
    if (eventName === 'error') throw new ApiError('stream', data)
    
    const event = readMessageEvent(payload)
    if (!event) continue
    yield event
    if (event.type === 'message_stop') return
  }
  throw new ApiError('interrupted', '')
}