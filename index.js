/**
 * 峰谷时段红底提醒 —— Host 侧。
 *
 * 可见行为全部在浏览器端（见 `dsh.client` 指向的 ./client.js）。Host 侧只做
 * 一件事：提供 `offpeak` 服务（getGoUsage / getBalance），替客户端查询
 * OpenCode Go 用量与 DeepSeek API 余额。
 * 网络请求放在这里（Node 上下文没有 CORS），API Key 也只在本进程内流转，
 * 不下发给浏览器端。
 *
 * 契约要点（对齐官方 Host 插件与 dsh-cost-meter）：
 * - `apply` 里注册的每个资源都要用 `ctx.effect`/`ctx.inject` 并在返回值里清理；
 * - 只有真正需要校验配置时才导出 `Config`。导出普通对象会让行校验失败、
 *   插件状态变「异常」；
 * - 不导出 `name`：行身份由 profile 补丁的 `id` 和包名决定；
 * - RPC 走 ./typert.host.js 的 Typert 清单（typert-loader 自动注册），本文件
 *   只在热重载兜底时手动 register。
 */
import fs from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { TYPERT } from './typert.host.js'

const PLUGIN_ID = 'dsh-offpeak-alert'

/**
 * OpenCode Go 用量查询端点与查询 UA。
 * UA 必须是浏览器形状：opencode.ai 前置的 Cloudflare 会拦非浏览器
 * UA（error 1010），这一点由 dsh-cost-meter 实测得出。
 */
const GO_QUOTA_URL = 'https://opencode.ai/zen/go/v1/usage'
const GO_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

/**
 * DeepSeek 余额查询端点（api-docs.deepseek.com「查询余额」）。只认官方
 * api.deepseek.com 的 Key，不拿中转站/代理路由的 Key 来查（见 deepseekKeyRefs）。
 */
const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance'
const REQUEST_TIMEOUT_MS = 15_000
const RESPONSE_MAX_BYTES = 256 * 1024
const OK_TTL_MS = 5 * 60 * 1000
const ERROR_TTL_MS = 60 * 1000

/**
 * DSH 凭据库是宿主内部包，旧版本可能没有。动态导入 + 兜底实现
 * （把变量名本身当引用），失败只降级、不让插件加载失败。
 */
let credentialRef = (name) => name
try {
  ;({ credentialRef } = await import('@deepseek-ai/dsh-credentials'))
} catch {
  /* 旧宿主没有 @deepseek-ai/dsh-credentials：只用环境变量与 auth.json */
}

/** 去掉可能被整段复制进来的 "Bearer " 前缀与首尾空白。 */
function normalizeKey(raw) {
  const trimmed = String(raw ?? '').trim()
  return trimmed.replace(/^Bearer\s+/i, '').trim()
}

/** 从 DSH 凭据库或同名环境变量解析一个引用；两个来源都没有时返回 null。 */
async function resolveCredentialRef(ctx, name) {
  try {
    const credentials = ctx.get('credentials')
    // 当前 dsh-credentials.resolve() 返回 { value, source }，不是密钥字符串本身。
    // 兼容旧接口若直接返回字符串；缺失/错误则继续查 env。
    const hit = await credentials?.resolve?.(credentialRef(name))
    const value = typeof hit === 'string' ? hit : hit?.value
    if (typeof value === 'string' && normalizeKey(value)) return normalizeKey(value)
  } catch {
    /* 无凭据服务/无该条目：继续往下找 */
  }
  try {
    const env = process.env[name]
    if (typeof env === 'string' && normalizeKey(env)) return normalizeKey(env)
  } catch {
    /* 环境变量读取异常时忽略 */
  }
  return null
}

/**
 * opencode CLI 的登录文件（`opencode-go` 条目）。OPENCODE_AUTH_CONTENT
 * 环境变量可整体覆盖该文件内容（opencode 自己的约定，照抄 cost-meter）。
 */
function findGoKeyInAuthJson() {
  const paths = [
    process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, 'opencode', 'auth.json') : null,
    join(homedir(), '.local', 'share', 'opencode', 'auth.json'),
    process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, 'opencode', 'auth.json') : null,
    join(homedir(), '.config', 'opencode', 'auth.json'),
  ]
  let raw = null
  const authContent = process.env.OPENCODE_AUTH_CONTENT
  try {
    if (typeof authContent === 'string' && authContent.trim()) {
      raw = authContent
    } else {
      for (const p of paths) {
        if (!p) continue
        try {
          raw = fs.readFileSync(p, 'utf8')
          break
        } catch {
          /* 换下一个候选路径 */
        }
      }
    }
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    const entry = parsed?.['opencode-go']
    if (!entry || typeof entry !== 'object') return null
    if (entry.type !== undefined && entry.type !== 'api') return null
    const key = normalizeKey(entry.key)
    return key || null
  } catch {
    return null
  }
}

/**
 * 只收集 DSH 模型设置中指向官方 OpenCode Go API 的凭据引用，
 * 避免误把其它 OpenCode Zen、自定义代理或其他厂商的 Key 用来查额度。
 */
function goKeyRefs(ctx) {
  const refs = new Set(['OPENCODE_GO_API_KEY'])
  try {
    const providers = ctx?.get?.('settings')?.get?.('llm-pi-ai')?.providers
    if (providers && typeof providers === 'object' && !Array.isArray(providers)) {
      for (const profile of Object.values(providers)) {
        if (typeof profile?.baseURL !== 'string' || typeof profile?.apiKeyEnv !== 'string') continue
        try {
          const url = new URL(profile.baseURL)
          if (url.origin !== 'https://opencode.ai'
            || !/^\/zen\/go\/v1\/?$/.test(url.pathname)
            || url.username || url.password || url.search || url.hash) continue
          const ref = profile.apiKeyEnv.trim()
          if (ref) refs.add(credentialRef(ref))
        } catch {
          /* 无效端点或环境变量名不参与发现。 */
        }
      }
    }
  } catch {
    /* 老宿主无 settings 服务时仍使用既有来源。 */
  }
  refs.add('OPENCODE_API_KEY')
  return [...refs]
}

/** Key 解析顺序：专用引用 → DSH 官方 Go 路由引用 → 兼容名 → auth.json。 */
async function resolveGoKey(ctx) {
  for (const name of goKeyRefs(ctx)) {
    const key = await resolveCredentialRef(ctx, name)
    if (key) return key
  }
  return findGoKeyInAuthJson()
}

/**
 * 只收集 DSH 模型设置中指向官方 DeepSeek API（api.deepseek.com，含 /v1
 * 兼容前缀）的凭据引用，避免误把中转站/代理路由的 Key 用来查官方余额。
 * apiKeyEnv 的值是引用名（如 OPENCODE_GO_API_KEY 那样的裸名），
 * resolveCredentialRef 会统一做一次 credentialRef 包装，这里不预包装。
 */
function deepseekKeyRefs(ctx) {
  const refs = new Set(['DEEPSEEK_API_KEY'])
  try {
    const providers = ctx?.get?.('settings')?.get?.('llm-pi-ai')?.providers
    if (providers && typeof providers === 'object' && !Array.isArray(providers)) {
      for (const profile of Object.values(providers)) {
        if (typeof profile?.baseURL !== 'string' || typeof profile?.apiKeyEnv !== 'string') continue
        try {
          const url = new URL(profile.baseURL)
          if (url.origin !== 'https://api.deepseek.com'
            || !/^\/(v1)?\/?$/.test(url.pathname)
            || url.username || url.password || url.search || url.hash) continue
          const ref = profile.apiKeyEnv.trim()
          if (ref) refs.add(ref)
        } catch {
          /* 无效端点或环境变量名不参与发现。 */
        }
      }
    }
  } catch {
    /* 老宿主无 settings 服务时仍使用既有来源。 */
  }
  return [...refs]
}

/** Key 解析顺序：专用引用 → DSH 官方 DeepSeek 路由引用（同名 env 由 resolveCredentialRef 兜底）。 */
async function resolveDeepseekKey(ctx) {
  for (const name of deepseekKeyRefs(ctx)) {
    const key = await resolveCredentialRef(ctx, name)
    if (key) return key
  }
  return null
}

/** 把响应体读上限截断，防止异常响应吃内存。 */
async function readBounded(body, maxBytes) {  const reader = body.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
    if (total > maxBytes) {
      try { await reader.cancel() } catch { /* 已截断即可 */ }
      break
    }
  }
  const merged = new Uint8Array(Math.min(total, maxBytes))
  let offset = 0
  for (const chunk of chunks) {
    if (offset >= merged.length) break
    merged.set(chunk.subarray(0, merged.length - offset), offset)
    offset += chunk.length
  }
  return new TextDecoder().decode(merged)
}

/** 非 ok 结果的统一兜底：所有字段都在，保证能过 GoUsage codec。 */
const resultShell = (status, message, detail) => ({
  status,
  message,
  detail,
  fetchedAt: Date.now(),
  windows: {},
})

/**
 * 查询一次 Go 用量。HTTP 语义错误（401/403/其它状态码）返回结构化结果，
 * 网络层错误（超时、ECONNRESET 等）抛出，由调用方重试/兜底。
 */
async function queryGoQuotaOnce(key) {
  const res = await fetch(GO_QUOTA_URL, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${normalizeKey(key)}`,
      accept: 'application/json',
      'user-agent': GO_UA,
    },
  })
  const text = await readBounded(res.body, RESPONSE_MAX_BYTES)
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }

  if (res.status === 401) {
    return resultShell(
      'error',
      'Go 登录无效',
      'OpenCode Go 的 API Key 已失效或被撤销；请重新登录 opencode 或更新凭据后重试。',
    )
  }
  if (res.status === 403 && json?.error?.type === 'EntitlementError') {
    return resultShell(
      'off',
      'Go 无订阅',
      '当前工作区没有 OpenCode Go 订阅；显示用量需要有效的 Go 订阅。',
    )
  }
  if (!res.ok) {
    return resultShell(
      'error',
      'Go 请求失败',
      `opencode.ai 返回 HTTP ${res.status}${text ? `：${text.slice(0, 200)}` : ''}`,
    )
  }

  // 成功响应：{usage:{rolling|weekly|monthly:{status,percent,resetsAt}}}
  // rolling 就是「5 小时窗口」，改名 five 供角标直接排版。
  const usage = json?.usage
  const windows = {}
  if (usage && typeof usage === 'object') {
    const map = { rolling: 'five', weekly: 'weekly', monthly: 'monthly' }
    for (const [src, dst] of Object.entries(map)) {
      const w = usage[src]
      const percent = typeof w?.percent === 'number' && Number.isFinite(w.percent) ? w.percent : null
      if (percent === null) continue
      windows[dst] = {
        percent,
        resetsAt: typeof w.resetsAt === 'string' ? w.resetsAt : '',
      }
    }
  }
  return { status: 'ok', message: '', fetchedAt: Date.now(), windows }
}

async function queryGoQuotaWithRetry(key) {
  try {
    return await queryGoQuotaOnce(key)
  } catch {
    // 网络抖动（超时/ECONNRESET）重试一次；再失败按网络错误兜底。
    try {
      return await queryGoQuotaOnce(key)
    } catch (error) {
      return resultShell('error', 'Go 请求失败', String(error?.message ?? error))
    }
  }
}

/** 余额结果的统一兜底：所有字段都在，保证能过 Balance codec。 */
const balanceShell = (status, message, detail) => ({
  status,
  message,
  detail,
  fetchedAt: Date.now(),
  currency: '',
  balance: '',
})

/**
 * 查询一次 DeepSeek API 余额。HTTP 语义错误返回结构化结果，
 * 网络层错误（超时、ECONNRESET 等）抛出，由调用方重试/兜底。
 *
 * 响应（api-docs.deepseek.com「查询余额」）：
 *   { is_available, balance_infos: [{ currency: 'CNY'|'USD',
 *     total_balance, granted_balance, topped_up_balance }] }
 * 多币种条目时优先取 CNY（角标排版是中文语境），其次取第一条；
 * balance 取 total_balance（含赠金与充值的可用总额）。
 */
async function queryBalanceOnce(key) {
  const res = await fetch(DEEPSEEK_BALANCE_URL, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${normalizeKey(key)}`,
      accept: 'application/json',
      'user-agent': GO_UA,
    },
  })
  const text = await readBounded(res.body, RESPONSE_MAX_BYTES)
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }

  if (res.status === 401) {
    return balanceShell(
      'error',
      'DeepSeek 登录无效',
      'DeepSeek API Key 已失效或被撤销；请在 DSH 凭据库更新 DEEPSEEK_API_KEY 后重试。',
    )
  }
  if (!res.ok) {
    return balanceShell(
      'error',
      '余额请求失败',
      `api.deepseek.com 返回 HTTP ${res.status}${text ? `：${text.slice(0, 200)}` : ''}`,
    )
  }

  const infos = Array.isArray(json?.balance_infos) ? json.balance_infos : []
  const info = infos.find((x) => x?.currency === 'CNY') ?? infos[0]
  if (!info) {
    return balanceShell(
      'off',
      '余额不可用',
      '接口没有返回余额条目（balance_infos 为空）。',
    )
  }
  const currency = typeof info.currency === 'string' ? info.currency : 'CNY'
  const total = info.total_balance
  const balance = typeof total === 'string' ? total
    : typeof total === 'number' && Number.isFinite(total) ? String(total) : ''
  return { status: 'ok', message: '', fetchedAt: Date.now(), currency, balance }
}

async function queryBalanceWithRetry(key) {
  try {
    return await queryBalanceOnce(key)
  } catch {
    // 网络抖动（超时/ECONNRESET）重试一次；再失败按网络错误兜底。
    try {
      return await queryBalanceOnce(key)
    } catch (error) {
      return balanceShell('error', '余额请求失败', String(error?.message ?? error))
    }
  }
}

/**
 * 5 分钟缓存 + 并发去重的通用包装：多个客户端窗口同时拉取也只发一次真实请求；
 * 出错结果用更短的 TTL，尽快恢复显示。onError 把 fetchFresh 抛出的网络错误
 * 折成对应的结构化结果（Go 用 resultShell，余额用 balanceShell）。
 */
function cachedQuery(fetchFresh, onError) {
  let cache = null
  let inflight = null
  return async () => {
    const now = Date.now()
    if (cache) {
      const ttl = cache.result.status === 'ok' ? OK_TTL_MS : ERROR_TTL_MS
      if (now - cache.at < ttl) return cache.result
    }
    if (!inflight) {
      inflight = fetchFresh()
        .catch((error) => onError(String(error?.message ?? error)))
        .then((result) => {
          cache = { at: Date.now(), result }
          return result
        })
        .finally(() => {
          inflight = null
        })
    }
    return inflight
  }
}

/**
 * 创建 offpeak 服务（getGoUsage + getBalance）。缓存与并发去重见 cachedQuery。
 */
function createOffpeakService(ctx) {
  const getGoUsage = cachedQuery(async () => {
    const key = await resolveGoKey(ctx)
    if (!key) {
      return resultShell(
        'off',
        'Go 未配置',
        '没有找到 OpenCode Go 的 API Key：DSH 凭据库（含模型设置里的官方 Go 路由）、'
        + 'OPENCODE_GO_API_KEY / OPENCODE_API_KEY 环境变量与 opencode auth.json 里都没有。配置任意一处即可。',
      )
    }
    return queryGoQuotaWithRetry(key)
  }, (detail) => resultShell('error', 'Go 请求失败', detail))

  const getBalance = cachedQuery(async () => {
    const key = await resolveDeepseekKey(ctx)
    if (!key) {
      return balanceShell(
        'off',
        '余额未配置',
        '没有找到 DeepSeek 的 API Key：DSH 凭据库（含模型设置里的官方 DeepSeek 路由）'
        + '与 DEEPSEEK_API_KEY 环境变量里都没有。配置任意一处即可。',
      )
    }
    return queryBalanceWithRetry(key)
  }, (detail) => balanceShell('error', '余额请求失败', detail))

  const service = { getGoUsage, getBalance }
  // dsh-api-gateway 的 validateBinding 要求 Host service 实例暴露此绑定，
  // 否则 strict Typert 描述符虽已解析，RPC 调用仍会报「没有可见的
  // typertRemote binding」。与 dsh-cost-meter 的手写绑定保持一致。
  Object.defineProperty(service, 'typertRemote', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { service, serviceKey: 'offpeak', namespace: 'offpeak' },
  })
  return service
}

/**
 * @param {any} ctx - Host 插件上下文。
 */
export function apply(ctx) {
  // RPC 数据面：把服务挂到 'offpeak' 命名空间（清单里 service:'offpeak'）。
  ctx.provide('offpeak', createOffpeakService(ctx))

  // RPC 描述面兜底：正常启动由 typert-loader 按 ./typert 清单自动注册；
  // 开发热重载（file: 入口）时 loader 可能漏注册，这里补一手。
  // 逻辑照抄 dsh-cost-meter：registry 已有本包清单时不重复注册。
  ctx.inject(['typert'], (typertCtx) => {
    const registry = typertCtx.typert
    if (registry.getPackage(PLUGIN_ID, 'host')) return
    if (!ctx.fiber?.entry || ctx.fiber.entry.options?.name?.startsWith?.('file:')) {
      registry.register(TYPERT)
    }
  })
}
