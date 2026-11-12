/**
 * 峰谷时段红底提醒 —— Host 面 Typert 清单。
 *
 * 手写清单，结构与 @deepseek-ai/dsh-typert-generator 产物一致（对齐
 * dsh-cost-meter/lib/typert.host.js）。`package.json` 的 exports["./typert"]
 * 指向本文件后，@deepseek-ai/dsh-typert-loader 会在插件挂载时严格校验并自动
 * 注册；本文件只导出 `TYPERT`，不导出其它名字。
 *
 * 契约要点（loader 逐条校验，改错任何一项插件直接注册失败）：
 * - package 必须等于包名，face 固定 'host'；
 * - model 三个数组可以全空，但键必须存在；
 * - invocations 每项：id/service/namespace/method 非空字符串，
 *   invocation.invocation = { kind: 'direct' }，parameters/result 各自带 codec；
 * - codec 必须是 strict：mode:'strict' + typeSymbol 非空 + create() 工厂。
 */
import { z } from 'zod'

/** 单个用量窗口：OpenCode Go 返回的 percent（数字）与 resetsAt（ISO 字符串）。 */
const goWindowSchema = z.object({
  percent: z.number(),
  resetsAt: z.string(),
})

/**
 * getGoUsage 的返回值。status 语义：
 * - 'ok'    拿到了用量（windows 里 five/weekly/monthly 可能只到一部分）；
 * - 'off'   中性状态：没配 Key 或工作区没有 Go 订阅，不是故障；
 * - 'error' 真故障（Key 失效、网络失败等）。
 * message 是角标可直接显示的短文案；detail 是给 Console/悬浮提示的长解释。
 */
export const goUsageSchema = z.object({
  status: z.enum(['off', 'ok', 'error']),
  message: z.string(),
  detail: z.string().optional(),
  fetchedAt: z.number(),
  windows: z.object({
    five: goWindowSchema.optional(),
    weekly: goWindowSchema.optional(),
    monthly: goWindowSchema.optional(),
  }),
})

/**
 * getBalance 的返回值。status 语义与 goUsageSchema 一致：
 * 'ok' 拿到了余额（balance 为 total_balance 字符串，currency 为 'CNY'/'USD'），
 * 'off' 没配 DeepSeek API Key 等中性状态，'error' 真故障。
 */
const balanceSchema = z.object({
  status: z.enum(['off', 'ok', 'error']),
  message: z.string(),
  detail: z.string().optional(),
  fetchedAt: z.number(),
  currency: z.string(),
  balance: z.string(),
})

const strictCodec = (name, schema) => ({
  mode: 'strict',
  typeSymbol: 'dsh-offpeak-alert#' + name,
  schema,
  create: () => schema,
})

const _goUsageCodec = strictCodec('GoUsage', goUsageSchema)
const _balanceCodec = strictCodec('Balance', balanceSchema)

export const TYPERT = {
  package: 'dsh-offpeak-alert',
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: [
    {
      id: 'dsh-offpeak-alert#offpeak/getGoUsage',
      service: 'offpeak',
      namespace: 'offpeak',
      method: 'getGoUsage',
      invocation: { kind: 'direct' },
      parameters: [],
      result: _goUsageCodec,
    },
    {
      id: 'dsh-offpeak-alert#offpeak/getBalance',
      service: 'offpeak',
      namespace: 'offpeak',
      method: 'getBalance',
      invocation: { kind: 'direct' },
      parameters: [],
      result: _balanceCodec,
    },
  ],
}
