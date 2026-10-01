window.__ModuleLoader__.load({
  id: '@local/dsh-offpeak-alert',
  factory() {
    /**
     * DeepSeek 峰谷时段角标 —— 客户端（浏览器）部分。
     *
     * 行为：只在窗口标题栏居中显示一个可拖动角标，给出当前时段与倒计时。
     * **本插件不改动任何背景色或主题令牌**，界面配色始终由主题决定。
     *
     * 口径来源：DeepSeek API 官方定价 https://api-docs.deepseek.com/quick_start/pricing
     * 高峰 = UTC 01:00-04:00 与 06:00-10:00，仅周一至周五，中国法定节假日除外；
     * 其余（含周末与法定节假日全天）为低谷，价格为高峰的一半。
     *
     * ⚠️ 时段规则是硬编码的（本插件不联网）。官网若调整规则，本插件不会自动跟上，
     *   只会按 SCHEDULE_VERIFIED_ON 的时限提醒你核对。改法见 README「规则会过期吗」一节。
     */

    const PLUGIN_ID = '@local/dsh-offpeak-alert';

    /** 最后一次人工核对官网规则的日期（YYYY-MM-DD）。每次核对后请更新。 */
    const SCHEDULE_VERIFIED_ON = '2026-10-01';

    /** 超过这个天数就在 Console 提醒核对官网。 */
    const SCHEDULE_MAX_AGE_DAYS = 90;

    /** 中国法定节假日（含调休连休整段）。2026 年取自国办发明电〔2025〕7 号。 */
    const OFFICIAL_HOLIDAYS = {
      2026: [
        ['元旦', ['2026-01-01', '2026-01-02', '2026-01-03']],
        ['春节', ['2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23']],
        ['清明节', ['2026-04-04', '2026-04-05', '2026-04-06']],
        ['劳动节', ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05']],
        ['端午节', ['2026-06-19', '2026-06-20', '2026-06-21']],
        ['中秋节', ['2026-09-25', '2026-09-26', '2026-09-27']],
        ['国庆节', ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']],
      ],
    };

    /** 内置年份之外用农历节日估算（正月初一 / 五月初五 / 八月十五的公历日期）。 */
    const LUNAR_FALLBACK = {
      2027: { 春节: '2027-02-06', 端午节: '2027-06-09', 中秋节: '2027-09-15' },
      2028: { 春节: '2028-01-26', 端午节: '2028-05-28', 中秋节: '2028-10-03' },
      2029: { 春节: '2029-02-13', 端午节: '2029-06-16', 中秋节: '2029-09-22' },
      2030: { 春节: '2030-02-03', 端午节: '2030-06-05', 中秋节: '2030-09-12' },
    };

    const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    const pad = (n) => String(n).padStart(2, '0');

    /** 把 UTC 毫秒拆成北京时间的日期分量（不依赖运行环境时区）。 */
    function beijingParts(ms) {
      const d = new Date(ms + 8 * 3600 * 1000);
      return {
        y: d.getUTCFullYear(),
        m: d.getUTCMonth() + 1,
        d: d.getUTCDate(),
        hh: d.getUTCHours(),
        mm: d.getUTCMinutes(),
        dow: d.getUTCDay(),
      };
    }

    const dateKey = (p) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;

    /**
     * 规则可能过期的自查。本地无法判断官网是否改过规则，
     * 因此只做两件能确切判断的事：
     *   1) 距离最后一次人工核对是否超过 SCHEDULE_MAX_AGE_DAYS 天；
     *   2) 当前年份的法定节假日是否为内置精确值（否则用的是农历估算）。
     * 返回提示数组，为空表示无需提醒。
     */
    function scheduleNotes(nowMs) {
      const notes = [];
      const verifiedAt = Date.parse(`${SCHEDULE_VERIFIED_ON}T00:00:00Z`);
      if (Number.isFinite(verifiedAt)) {
        const ageDays = Math.floor((nowMs - verifiedAt) / 86400000);
        if (ageDays > SCHEDULE_MAX_AGE_DAYS) {
          notes.push(
            `峰谷规则已 ${ageDays} 天未核对（上次 ${SCHEDULE_VERIFIED_ON}）。`
            + '请打开 https://api-docs.deepseek.com/quick_start/pricing 确认时段是否仍为 UTC 01:00-04:00 / 06:00-10:00（仅工作日，法定节假日除外）；'
            + '若有变化，请更新 client.js 里 statusAt() 的时间判断，并把 SCHEDULE_VERIFIED_ON 改成今天。',
          );
        }
      }
      const year = beijingParts(nowMs).y;
      if (!OFFICIAL_HOLIDAYS[year]) {
        notes.push(
          `${year} 年的法定节假日为农历估算值（内置精确安排只到 ${Object.keys(OFFICIAL_HOLIDAYS).sort().pop()} 年）。`
          + '请核对国务院办公厅当年放假通知，并把精确日期补进 OFFICIAL_HOLIDAYS。',
        );
      }
      return notes;
    }

    function shiftDays(iso, days) {
      const [y, m, d] = iso.split('-').map(Number);
      const g = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
      return `${g.getUTCFullYear()}-${pad(g.getUTCMonth() + 1)}-${pad(g.getUTCDate())}`;
    }

    /** 某公历年的法定节假日表（日期字符串 -> 节日名）与来源标记。 */
    function holidaysOf(year) {
      const table = new Map();
      const add = (key, name) => table.set(key, name);

      const official = OFFICIAL_HOLIDAYS[year];
      if (official) {
        for (const [name, days] of official) for (const day of days) add(day, name);
        return { table, source: `official-${year}` };
      }

      add(`${year}-01-01`, '元旦');
      for (let d = 1; d <= 5; d++) add(`${year}-05-${pad(d)}`, '劳动节');
      for (let d = 1; d <= 7; d++) add(`${year}-10-${pad(d)}`, '国庆节');

      const y100 = year % 100;
      const qingming = Math.floor(y100 * 0.2422 + 4.81) - Math.floor(y100 / 4);
      add(`${year}-04-${pad(qingming)}`, '清明节');

      const lunar = LUNAR_FALLBACK[year];
      if (lunar) {
        add(lunar.春节, '春节');
        for (let i = 1; i <= 6; i++) {
          const key = shiftDays(lunar.春节, i);
          if (!table.has(key)) add(key, '春节');
        }
        add(lunar.端午节, '端午节');
        add(lunar.中秋节, '中秋节');
      }
      return { table, source: 'estimated' };
    }

    const holidayCache = new Map();
    function holiday(year) {
      let entry = holidayCache.get(year);
      if (!entry) {
        entry = holidaysOf(year);
        holidayCache.set(year, entry);
      }
      return entry;
    }

    /** 核心判定：给定 UTC 毫秒，返回该时刻的峰谷状态。 */
    function statusAt(ms) {
      const bj = beijingParts(ms);
      const key = dateKey(bj);
      const { table, source } = holiday(bj.y);
      const holidayName = table.get(key) || null;

      let peak;
      let reason;
      if (holidayName) {
        peak = false;
        reason = `中国法定节假日（${holidayName}），全天低谷`;
      } else if (bj.dow === 0 || bj.dow === 6) {
        peak = false;
        reason = '周末，全天低谷';
      } else {
        const minutes = bj.hh * 60 + bj.mm;
        peak = (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60);
        reason = peak ? '工作日高峰时段（北京时间 09:00-12:00 / 14:00-18:00）' : '工作日高峰时段之外';
      }

      return {
        peak,
        status: peak ? 'peak' : 'off-peak',
        multiplier: peak ? 1 : 0.5,
        dateKey: key,
        time: `${pad(bj.hh)}:${pad(bj.mm)}`,
        weekday: WEEKDAYS[bj.dow],
        holidayName,
        holidaySource: source,
        reason,
      };
    }

    /** 下一次状态切换：15 分钟步进扫描 + 二分收敛到分钟。 */
    function nextSwitch(ms) {
      const current = statusAt(ms).peak;
      const STEP = 15 * 60 * 1000;
      const LIMIT = ms + 30 * 86400000;
      let prev = ms;
      let probe = ms;
      while (probe < LIMIT) {
        probe += STEP;
        if (statusAt(probe).peak !== current) {
          let lo = prev;
          let hi = probe;
          while (hi - lo > 30 * 1000) {
            const mid = lo + Math.floor((hi - lo) / 2);
            if (statusAt(mid).peak === current) lo = mid;
            else hi = mid;
          }
          return { at: hi, peak: !current };
        }
        prev = probe;
      }
      return null;
    }

    function countdownText(ms, target) {
      const minutes = Math.max(0, Math.round((target - ms) / 60000));
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return h > 0 ? `${h} 小时 ${m} 分钟` : `${m} 分钟`;
    }

    /**
     * 高峰态的视觉覆盖。
     *
     * 主题把界面底色与卡片层次都建立在 `--dsw-static-neutral-bluish-*` 灰阶上
     * （`--dsw-alias-bg-base`、`--dsw-alias-bg-layer-*`、`--dsw-alias-bg-overlay`、
     * `--dsw-alias-bg-module-platform` 都是它的别名）。因此在 body 上重定义这一串
     * 灰阶为同明度的红阶，整页、卡片、浮层会整体转红而保留原有层次；
     * 低谷时本样式表不加载，界面完全恢复原主题。
     */
    /**
     * 角标样式：深浅两套主题**共用同一套配色**（不引用任何主题令牌，
     * 因此不会随主题切换而变色）。
     *
     * 高峰：深红底 + 近白文字 + 深红圆点脉冲
     * 低谷：低调的中性底色，只作安静的状态提示
     *
     * 本插件**不改动任何背景色**，只插入这一个 position:fixed 的角标。
     */
    const BADGE_CSS = `
    /* 整条角标都是拖拽手柄：按住任意位置即可拖动（关闭按钮除外）。
       因此整块接收鼠标事件，且不改变光标形状（保持普通箭头）。
       低谷态按主题分两套：浅色主题＝浅灰底 + 深色字，深色主题＝深灰底 + 浅色字。
       注意必须按 body[data-ds-dark-theme] 分支 —— DSH 的主题切换靠这个属性，
       用 prefers-color-scheme 媒体查询会跟着系统走、而不是跟着应用内设置走。 */
    [data-dsh-offpeak-badge] {
      position: fixed;
      right: 12px;
      bottom: 12px;
      z-index: 2147483000;
      display: flex;
      flex-direction: row;
      flex-wrap: nowrap;
      align-items: center;
      gap: 6px;
      max-width: calc(100vw - 24px);
      box-sizing: border-box;
      margin: 0;
      padding: 4px 10px;
      border-radius: 999px;
      /* 浅色主题（默认）：浅灰底 + 深色字 */
      border: 1px solid #0000001f;
      background: #edeef0f2;
      color: #1f2126;      font: 500 11px/16px var(--dsw-font-family, system-ui, sans-serif);
      letter-spacing: 0.2px;
      white-space: nowrap;
      overflow: visible;
      cursor: default;
      pointer-events: auto;
      -webkit-app-region: no-drag;
      touch-action: none;
      user-select: none;
      opacity: 0.9;
    }

    /* 深色主题：深灰底 + 浅色字（与之前一致）。
       用完整的 border 简写而不是只覆盖 border-color，避免与基础规则的简写相互串色。 */
    body[data-ds-dark-theme] [data-dsh-offpeak-badge] {
      border: 1px solid #ffffff2e;
      background: #1c1c1feb;
      color: #f2f2f4;
      opacity: 0.72;
    }

    /* 高峰（浅色主题）：深红底 + 浅字。
       语法刻意保持简单：高峰规则不带主题条件，深色主题随后显式覆盖
       （body[data-ds-dark-theme] 特异性更高 + 声明更靠后）。
       这样"浅色变红、深色不变"的意图谁都能一眼看懂，也不依赖 :not() 的解析。 */
    [data-dsh-offpeak-badge][data-state="peak"] {
      border: 1px solid #8f1420;
      background: #8f1420;
      color: #ffe9ea;
      box-shadow: 0 1px 6px #8f142066;
      opacity: 1;
    }

    /* 深色主题在高峰保持深灰底（覆盖上面的红色，并换掉红色投影） */
    body[data-ds-dark-theme] [data-dsh-offpeak-badge][data-state="peak"] {
      border: 1px solid #ffffff2e;
      background: #1c1c1feb;
      color: #f2f2f4;
      box-shadow: 0 1px 6px #00000059;
      opacity: 1;
    }

    [data-dsh-offpeak-badge][data-dragging] {
      opacity: 1;
      user-select: none;
    }

    /* 规则可能过期：在角标右上内侧点一个小圆点（不新增元素、不影响拖动命中） */
    [data-dsh-offpeak-badge][data-stale] {
      box-shadow: inset -3px 3px 0 -1px #e5a020;
    }

    [data-dsh-offpeak-badge] .dsh-offpeak-text {
      flex: 0 1 auto;
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* 关闭按钮：整条可拖，但按钮本身仍是"点击关闭"，
       所以拖动逻辑会跳过按钮区域。 */
    [data-dsh-offpeak-badge] .dsh-offpeak-close {
      flex: 0 0 auto;
      width: 14px;
      height: 14px;
      margin: 0 0 0 2px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: inherit;
      font: 400 12px/14px var(--dsw-font-family, system-ui, sans-serif);
      text-align: center;
      opacity: 0.65;
      cursor: pointer;
      -webkit-app-region: no-drag;
      transition: opacity 0.12s ease-out, background-color 0.12s ease-out;
    }

    /* 悬浮底色：浅色主题用黑色淡底，深色主题用白色淡底 */
    [data-dsh-offpeak-badge] .dsh-offpeak-close:hover {
      opacity: 1;
      background: #00000018;
    }

    body[data-ds-dark-theme] [data-dsh-offpeak-badge] .dsh-offpeak-close:hover {
      background: #ffffff2b;
    }

    /* 高峰时关闭按钮处于红底之上：白淡底更清楚 */
    [data-dsh-offpeak-badge][data-state="peak"] .dsh-offpeak-close:hover {
      background: #ffffff33;
    }

    [data-dsh-offpeak-badge] .dsh-offpeak-close:focus-visible {
      opacity: 1;
      outline: 2px solid currentColor;
      outline-offset: 1px;
    }
    `;

    const BADGE_ATTR = 'data-dsh-offpeak-badge';

    /** 安装角标样式表；返回清理函数。本插件不改动任何背景。 */
    function installStyles() {
      if (typeof document === 'undefined') return () => {};
      const tag = document.createElement('style');
      tag.dataset.plugin = PLUGIN_ID;
      tag.dataset.pluginCss = `${PLUGIN_ID}/badge`;
      tag.textContent = BADGE_CSS;
      document.head.appendChild(tag);
      return () => tag.remove();
    }

    /**
     * 关闭状态：记在 sessionStorage。
     * 语义是"本次运行不想看到它"—— 关掉后本次会话内不再出现，
     * 重开应用（新会话）时角标会重新出现，避免永久静默错过高峰提醒。
     * 存储不可用时退化为"本次页面内记住"。
     */
    const DISMISS_KEY = 'dsh-offpeak-badge-dismissed';
    let dismissedInMemory = false;

    function isDismissed() {
      if (dismissedInMemory) return true;
      try {
        return sessionStorage.getItem(DISMISS_KEY) === '1';
      } catch {
        return false;
      }
    }

    function setDismissed() {
      dismissedInMemory = true;
      try {
        sessionStorage.setItem(DISMISS_KEY, '1');
      } catch {
        /* 隐私模式等场景：内存标记已足够本次运行生效 */
      }
    }

    function ensureBadge() {
      if (typeof document === 'undefined') return null;
      let badge = document.querySelector(`[${BADGE_ATTR}]`);
      if (badge) return badge;
      badge = document.createElement('div');
      badge.setAttribute(BADGE_ATTR, '');
      badge.setAttribute('role', 'status');
      badge.setAttribute('aria-live', 'polite');
      badge.setAttribute('title', '按住可拖动');
      const text = document.createElement('span');
      text.className = 'dsh-offpeak-text';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'dsh-offpeak-close';
      close.setAttribute('aria-label', '关闭峰谷时段角标');
      close.setAttribute('title', '关闭（本次运行不再显示）');
      close.textContent = '\u00d7';
      badge.append(text, close);
      document.body.appendChild(badge);
      return badge;
    }

    /**
     * 角标位置：按住角标任意位置即可拖动，坐标存 localStorage，重开应用后保持。
     * 没存过位置时回到默认的右下角（CSS 的 right/bottom）。
     */
    const POS_KEY = 'dsh-offpeak-badge-pos';
    const DRAG_THRESHOLD = 4;

    /** 当前视口内的合法坐标区间（留 4px 边距，保证角标可被拖回来）。 */
    function clampPosition(x, y, badge) {
      const winW = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1280;
      const winH = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 800;
      const w = badge && badge.offsetWidth ? badge.offsetWidth : 260;
      const h = badge && badge.offsetHeight ? badge.offsetHeight : 24;
      return {
        x: Math.max(4, Math.min(x, Math.max(4, winW - w - 4))),
        y: Math.max(4, Math.min(y, Math.max(4, winH - h - 4))),
      };
    }

    function readStoredPosition() {
      try {
        const raw = localStorage.getItem(POS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
        return { x: parsed.x, y: parsed.y };
      } catch {
        return null;
      }
    }

    function storePosition(pos) {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(pos));
      } catch {
        /* 存储不可用时仅本次运行内生效 */
      }
    }

    /** 把坐标写到内联样式上；CSS 里的 right/bottom 被内联 auto 覆盖。 */
    function placeBadge(badge, pos) {
      if (!pos) {
        badge.style.removeProperty('left');
        badge.style.removeProperty('top');
        badge.style.removeProperty('right');
        badge.style.removeProperty('bottom');
        return;
      }
      badge.style.left = `${pos.x}px`;
      badge.style.top = `${pos.y}px`;
      badge.style.right = 'auto';
      badge.style.bottom = 'auto';
    }

    /** 把已保存的位置应用到角标（含视口变化后的重新收敛）。 */
    function applyStoredPosition() {
      const badge = document.querySelector(`[${BADGE_ATTR}]`);
      if (!badge) return;
      const stored = readStoredPosition();
      if (!stored) return;
      const pos = clampPosition(stored.x, stored.y, badge);
      placeBadge(badge, pos);
      if (pos.x !== stored.x || pos.y !== stored.y) storePosition(pos);
    }

    /**
     * 默认位置：标题栏水平居中、贴着窗口顶边留 4px。
     * 用户拖动过之后就不再自动居中（重开应用也保持用户摆的位置）。
     * 只有"从未拖过"时才在窗口尺寸变化后重新居中。
     */
    function applyDefaultPosition() {
      const badge = document.querySelector(`[${BADGE_ATTR}]`);
      if (!badge) return;
      if (readStoredPosition()) return; // 用户摆过位置，尊重它
      const winW = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1280;
      const w = badge.offsetWidth || 240;
      placeBadge(badge, { x: Math.round((winW - w) / 2), y: 4 });
    }

    /** 回到默认的标题栏居中定位（清掉用户摆过的位置）。 */
    function resetPosition() {
      try {
        localStorage.removeItem(POS_KEY);
      } catch {
        /* 存储不可用时清掉内联样式即可 */
      }
      applyDefaultPosition();
      return true;
    }

    /** 把当前状态同步到角标：data-state 决定配色，文字给出时段与倒计时。 */
    function paint() {
      if (typeof document === 'undefined' || !document.body) return;

      const badge = ensureBadge();
      if (!badge) return;

      // 已关闭：移除角标并停在这儿，不再重建。
      if (isDismissed()) {
        badge.remove();
        return;
      }

      // 位置只写一次：拖动或视口变化时才需要重新落位。
      if (!badge.dataset.positioned) {
        if (readStoredPosition()) applyStoredPosition();
        else applyDefaultPosition();
        badge.dataset.positioned = '1';
      }

      const now = Date.now();
      const state = statusAt(now);
      badge.dataset.state = state.status;
      const sw = nextSwitch(now);
      const parts = [
        state.peak ? '高峰期 1×' : '低谷期 0.5×',
        state.holidayName,
        sw ? `${sw.peak ? '转高峰' : '转低谷'} ${countdownText(now, sw.at)}后` : null,
      ].filter(Boolean);
      // 规则可能过期时，角标末尾加一个标记，提示去 Console 看详情
      const notes = scheduleNotes(now);
      if (notes.length) {
        parts.push('规则待核');
        badge.dataset.stale = '1';
        warnOnce(notes);
      } else {
        delete badge.dataset.stale;
      }
      badge.querySelector('.dsh-offpeak-text').textContent = parts.join(' · ');
    }

    /** 规则过期的提醒只在 Console 打一次，避免每 30 秒刷屏。 */
    let staleWarned = false;
    function warnOnce(notes) {
      if (staleWarned) return;
      staleWarned = true;
      try {
        console.warn(
          '[dsh-offpeak-alert] 峰谷规则可能已过期，当前判定可能不准：\n· '
          + notes.join('\n· ')
          + '\n（本插件不联网，无法自动跟进官网改动；核对后请更新 client.js 里的 SCHEDULE_VERIFIED_ON。）',
        );
      } catch {
        /* 控制台不可用时忽略 */
      }
    }

    /**
     * 客户端插件体：只往页面插入一个右下角角标，不占用插槽、不引入 Client 包、
     * **不改动任何背景色或主题令牌**，因此不会与宿主布局或其它插件冲突。
     *
     * @param {any} ctx - 客户端 Cordis 上下文。
     */
    function apply(ctx) {
      if (typeof document === 'undefined') return;

      // 只读查询入口，方便在开发者工具 Console 里核对判定：
      //   __dshOffpeak.status()        当前时段、判断依据、规则是否可能过期
      //   __dshOffpeak.nextSwitch()    下一次切换时刻
      //   __dshOffpeak.showBadge()     手动恢复被关闭的角标
      window.__dshOffpeak = {
        status: () => {
          const now = Date.now();
          const notes = scheduleNotes(now);
          for (const n of notes) {
            try { console.warn(`[dsh-offpeak-alert] ${n}`); } catch { /* 控制台不可用 */ }
          }
          return {
            ...statusAt(now),
            scheduleVerifiedOn: SCHEDULE_VERIFIED_ON,
            scheduleNotes: notes,
          };
        },
        nextSwitch: () => nextSwitch(Date.now()),
        showBadge: () => {
          dismissedInMemory = false;
          try {
            sessionStorage.removeItem(DISMISS_KEY);
          } catch {
            /* 存储不可用时清掉内存标记即可 */
          }
          paint();
          // 角标是重新创建的，事件要重新绑上
          if (typeof bindBadgeEvents === 'function') bindBadgeEvents();
          return true;
        },
        resetPosition,
      };

      const onCloseClick = (event) => {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        setDismissed();
        const current = document.querySelector(`[${BADGE_ATTR}]`);
        if (current) current.remove();
      };

      // 按住角标任意位置即可拖动。用 pointer 事件，鼠标/触控/触控笔都适用。
      let dragState = null;

      const onPointerDown = (event) => {
        if (event.button !== undefined && event.button !== 0) return; // 只响应左键
        // 关闭按钮区域留给点击，不参与拖动
        const target = event.target;
        if (target && target.closest && target.closest('.dsh-offpeak-close')) return;
        const badge = event.currentTarget;
        if (!badge) return;
        const rect = badge.getBoundingClientRect();
        dragState = {
          badge,
          startX: event.clientX,
          startY: event.clientY,
          left: rect.left,
          top: rect.top,
          moved: false,
        };
        try {
          badge.setPointerCapture(event.pointerId);
        } catch {
          /* 不支持指针捕获时退化为普通拖动 */
        }
      };

      const onPointerMove = (event) => {
        if (!dragState) return;
        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;
        // 超过阈值才算拖动，避免单纯点击时角标轻微跳动
        if (!dragState.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        if (!dragState.moved) {
          dragState.moved = true;
          dragState.badge.setAttribute('data-dragging', '');
        }
        const pos = clampPosition(dragState.left + dx, dragState.top + dy, dragState.badge);
        placeBadge(dragState.badge, pos);
      };

      const finishDrag = (event) => {
        if (!dragState) return;
        const { badge, moved } = dragState;
        if (event && event.currentTarget && event.pointerId !== undefined) {
          try {
            event.currentTarget.releasePointerCapture(event.pointerId);
          } catch {
            /* 未捕获时忽略 */
          }
        }
        badge.removeAttribute('data-dragging');
        if (moved) {
          const rect = badge.getBoundingClientRect();
          storePosition(clampPosition(Math.round(rect.left), Math.round(rect.top), badge));
          // 拖动刚结束可能紧跟一次 click，标记一下让关闭按钮忽略它
          badge.dataset.justDragged = '1';
          setTimeout(() => {
            if (badge.dataset) delete badge.dataset.justDragged;
          }, 0);
        }
        dragState = null;
      };

      // 视口变化：用户摆过位置就重新收敛回可视区；从未拖过则重新居中
      const onWindowResize = () => {
        if (readStoredPosition()) applyStoredPosition();
        else applyDefaultPosition();
      };

      /**
       * 把事件绑到当前角标上。做成幂等：元素没变就跳过。
       * 角标可能因为"已关闭"而尚未创建，也可能被 showBadge() 重新创建，
       * 所以绑定不能只做一次 —— 每次重建后都要重新调用。
       */
      const bound = { badge: null, close: null };
      const bindDrag = (el) => {
        el.addEventListener('pointerdown', onPointerDown);
        el.addEventListener('pointermove', onPointerMove);
        el.addEventListener('pointerup', finishDrag);
        el.addEventListener('pointercancel', finishDrag);
      };
      const unbindDrag = (el) => {
        el.removeEventListener('pointerdown', onPointerDown);
        el.removeEventListener('pointermove', onPointerMove);
        el.removeEventListener('pointerup', finishDrag);
        el.removeEventListener('pointercancel', finishDrag);
      };
      function bindBadgeEvents() {
        const badge = document.querySelector(`[${BADGE_ATTR}]`);
        if (!badge) return;
        // 整条角标即拖拽手柄
        if (badge !== bound.badge) {
          if (bound.badge) unbindDrag(bound.badge);
          bindDrag(badge);
          bound.badge = badge;
        }
        const close = badge.querySelector('.dsh-offpeak-close');
        if (close && close !== bound.close) {
          if (bound.close) bound.close.removeEventListener('click', onCloseClick);
          close.addEventListener('click', onCloseClick);
          bound.close = close;
        }
      }

      ctx.effect(installStyles, 'offpeak-alert: badge stylesheet');
      ctx.effect(() => {
        paint();
        const timer = setInterval(paint, 30000);

        bindBadgeEvents();
        // 角标本轮没创建时（启动即处于关闭状态），下一轮再试
        if (!bound.badge) setTimeout(bindBadgeEvents, 0);

        window.addEventListener('resize', onWindowResize);

        return () => {
          clearInterval(timer);
          if (bound.badge) unbindDrag(bound.badge);
          if (bound.close) bound.close.removeEventListener('click', onCloseClick);
          window.removeEventListener('resize', onWindowResize);
          delete window.__dshOffpeak;
          const current = document.querySelector(`[${BADGE_ATTR}]`);
          if (current) current.remove();
        };
      }, 'offpeak-alert: status polling and badge');
    }

    return { name: PLUGIN_ID, apply };
  },
});


