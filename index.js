/**
 * 峰谷时段红底提醒 —— Host 侧。
 *
 * 可见行为全部在浏览器端（见 `dsh.client` 指向的 ./client.js），Host 侧不需要
 * 任何服务，因此这里只导出 `apply`。
 *
 * 契约要点（对齐官方 Host 插件，如 dsh-skill-badge）：
 * - `apply` 里注册的每个资源都要用 `ctx.effect`/`ctx.on` 并在返回值里清理；
 * - 只有真正需要校验配置时才导出 `Config`，且必须是 schemastery schema
 *   （`z.object({...})`）。导出普通对象会让行校验失败、插件状态变「异常」；
 * - 不导出 `name`：行身份由 profile 补丁的 `id` 和包名决定，多导出一个名字
 *   只会多一处与包名/行 id 不一致的机会。
 */

/**
 * @param {unknown} _ctx - Host 插件上下文，本插件不使用。
 */
export function apply(_ctx) {
  // 有意为空：本插件的效果全部由客户端插件完成。
}
