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
  // 因为前端不再需要鉴权，这里传空字符串。后端会接管注入
  'x-api-key': '', 
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

/** 用 GET /models 校验 API Key（不产生费用） */
export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  // 【核心修改】：直接返回成功，不发出任何网络请求
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
  // 加上 ?path=/files 让后端代理识别
  const response = await request(`${ANTHROPIC_BASE_URL}?path=/files`, {
    method: 'POST',
    headers: anthropicHeaders(apiKey, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

export const deleteFile = async (apiKey: string, fileId: string): Promise<void> => {
  // 加上 ?path=/files/xxx 让后端代理识别
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
  // 加上 ?path=/messages 让后端代理识别
  const response = await request(`${ANTHROPIC_BASE_URL}?path=/messages`, {
    method: 'POST',
    headers: {
      ...anthropicHeaders(apiKey, hasFile(body)),
      'Content-Type': 'application/json',
      Accept: 'application/json', // 【核心修改】：只接收普通 JSON
    },
    // 【核心修改】：强制关闭 stream
    body: JSON.stringify({ ...body, stream: false }),
    signal,
  })
  
  // 直接读取完整的 JSON 文本，不再走流解析
  const text = await response.text()
  let payload: any
  try {
    payload = JSON.parse(text)
  } catch (e) {
    throw new ApiError('protocol', "后端返回了非 JSON 格式：" + text)
  }

  if (isErrorBody(payload)) {
    throw new ApiError('http', payload.error.message)
  }

  // 提取文字（兼容 Anthropic 格式或 OpenAI 格式）
  let finalText = ''
  if (payload.content && payload.content[0]?.text) {
    finalText = payload.content[0].text
  } else if (payload.choices && payload.choices[0]?.message?.content) {
    finalText = payload.choices[0].message.content
  } else {
    finalText = text
  }

  // 伪装成流事件给 UI，让它直接显示完整文本
  // 伪装成标准的流事件给 UI
  yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } as any
  yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: finalText } } as any
  yield { type: 'content_block_stop', index: 0 } as any
  yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } } as any
  yield { type: 'message_stop' } as any
  return