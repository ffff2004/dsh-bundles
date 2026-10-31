/**
 * Codex quota, browser half: a `settings.section` page for the account the
 * `codex-live` provider runs on.
 *
 * The Host owns every conversation with the ChatGPT backend and the
 * `~/.codex/auth.json` credential; this half only reads the two frozen JSON
 * routes `index.js` registers. That split is also why the page can render a
 * `status` union directly: a missing credential, an expired token, an API-key
 * account, and an upstream failure are page states, not HTTP errors.
 *
 * The page is deliberately stateless across mounts: it reads once, never polls
 * or refreshes on focus, and a reset-credit redemption is the only write it can
 * trigger. That write is confirmed through the platform `Modal` (focus trap and
 * Escape included), and its `redeemRequestId` is minted when the dialog opens so
 * a retry of the same confirmation is idempotent on the Host.
 *
 * Formatting helpers are plain functions without React or DOM so `client.test.mjs`
 * can exercise the calendar and percentage rules directly through `__test`.
 */

;(function () {
  /** Locale namespace of this plugin's copy. */
  const NS = 'codexQuota'

  /**
   * Document-relative copies of the Host routes. They must stay in step with
   * `QUOTA_PATH` / `CONSUME_PATH` in `index.js`: the two halves are separate
   * artifacts sharing no module, so a test pins the two spellings together.
   */
  const QUOTA_URL = 'api/codex-live/quota'
  const CONSUME_URL = 'api/codex-live/quota/consume'

  /**
   * The credential path this page names when the Host does not report one. The
   * Host sends `authPath` because `codexHome` is configurable: the default reads
   * `~/.codex/auth.json`, a custom one does not, and a wrong path is worse than
   * none in the one message meant to help someone fix their login.
   */
  const AUTH_PATH = '~/.codex/auth.json'

  /** The credential path a status should name, falling back to the default home. */
  function authPathOf(view) {
    return typeof view?.authPath === 'string' && view.authPath.length > 0 ? view.authPath : AUTH_PATH
  }

  /** Percentages at or below this remain readable but turn warning-colored. */
  const LOW_REMAINING_PERCENT = 10

  /** Credits expiring inside this horizon get warning-colored expiry text. */
  const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000

  /** Window-label thresholds: hours below two days, whole days from there on. */
  const HOUR_SECONDS = 60 * 60
  const DAY_SECONDS = 48 * HOUR_SECONDS
  const SECONDS_PER_DAY = 24 * HOUR_SECONDS

  /** English month abbreviations for the cross-day form; fixed so formatting cannot drift with ICU data. */
  const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  /** Simplified Chinese dictionary (the key-set source of truth). */
  const zh = {
    'nav': 'Codex 额度',
    'intro': '数据来自 codex CLI 的登录凭据，只读展示；使用重置券会真实重置用量。',
    'refresh': '刷新',
    'updatedAt': '更新于 {time}',
    'windowFallback': '窗口',
    'hours': '{count} 小时',
    'days': '{count} 天',
    'remainingPercent': '剩余 {percent}%',
    'resetAt': '{time} 重置',
    'dateTime': '{month} 月 {day} 日 {time}',
    'creditsToggle': '重置券（{count}）',
    'creditsUnavailable': '可用 {count} 张 · 详情读取失败',
    'creditsEmpty': '暂无重置券',
    'retry': '重试',
    'creditFallback': '重置券',
    'use': '使用',
    'neverExpires': '不过期',
    'nearestExpiry': '最近过期',
    'expiryAt': '{time} 过期',
    'expirySentence': '券于 {time} 过期。',
    'confirmTitle': '使用重置券？',
    'confirmBody': '将重置当前 {windows} 窗口的已用额度，且不可撤销。',
    'confirmBodyGeneric': '将重置当前额度，且不可撤销。',
    'windowWithRemaining': '{label}（剩余 {percent}%）',
    'listSeparator': '、',
    'confirmEarlier': '注意：还有更早过期的券（{time}），建议先用它。',
    'redeem': '使用',
    'redeeming': '使用中…',
    'cancel': '取消',
    'close': '关闭',
    'redeemFailed': '兑换失败，请重试',
    'outcomeReset': '已重置 {count} 个窗口',
    'outcomeResetNoCount': '已重置',
    'outcomeNothingToReset': '当前没有需要重置的用量，券未消耗',
    'outcomeNoCredit': '没有可用重置券',
    'outcomeAlreadyRedeemed': '这张券已生效或已被使用',
    'outcomeUnknown': '兑换已完成，请刷新查看结果',
    'noCredential': '未找到 Codex 登录凭据。',
    'tokenExpired': 'Codex 登录凭据已过期。',
    'credentialFile': '凭据文件：{path}',
    'runCodex': '运行一次 codex CLI 刷新登录。',
    'noPlan': '该账号没有额度窗口（API-key 登录）。',
    'upstreamError': '读取失败',
    'requestFailed': '读取失败，请重试',
    'loading': '读取中…',
  }

  /** English dictionary, key-identical to the Chinese source of truth. */
  const en = {
    'nav': 'Codex quota',
    'intro': 'Data comes from the codex CLI login credential and is read-only; redeeming a reset credit really resets usage.',
    'refresh': 'Refresh',
    'updatedAt': 'Updated at {time}',
    'windowFallback': 'Window',
    'hours': '{count} h',
    'days': '{count} d',
    'remainingPercent': '{percent}% left',
    'resetAt': 'resets at {time}',
    'dateTime': '{month} {day}, {time}',
    'creditsToggle': 'Reset credits ({count})',
    'creditsUnavailable': '{count} available · could not load details',
    'creditsEmpty': 'No reset credits',
    'retry': 'Retry',
    'creditFallback': 'Reset credit',
    'use': 'Use',
    'neverExpires': 'Does not expire',
    'nearestExpiry': 'Expires soonest',
    'expiryAt': 'expires {time}',
    'expirySentence': 'The credit expires on {time}.',
    'confirmTitle': 'Use a reset credit?',
    'confirmBody': 'This resets the used usage of the current {windows} windows and cannot be undone.',
    'confirmBodyGeneric': 'This resets the current quota and cannot be undone.',
    'windowWithRemaining': '{label} ({percent}% left)',
    'listSeparator': ', ',
    'confirmEarlier': 'Note: a credit expiring earlier is still available ({time}); use it first.',
    'redeem': 'Use',
    'redeeming': 'Using…',
    'cancel': 'Cancel',
    'close': 'Close',
    'redeemFailed': 'Redemption failed. Try again.',
    'outcomeReset': 'Reset {count} windows',
    'outcomeResetNoCount': 'Reset',
    'outcomeNothingToReset': 'There was nothing to reset; the credit was not used',
    'outcomeNoCredit': 'No reset credit is available',
    'outcomeAlreadyRedeemed': 'This credit was already applied or used',
    'outcomeUnknown': 'Redemption finished; refresh to see the result',
    'noCredential': 'No Codex login credential was found.',
    'tokenExpired': 'The Codex login credential has expired.',
    'credentialFile': 'Credential file: {path}',
    'runCodex': 'Run the codex CLI once to refresh the login.',
    'noPlan': 'This account has no quota windows (API-key login).',
    'upstreamError': 'Could not read quota',
    'requestFailed': 'Could not read quota. Try again.',
    'loading': 'Loading…',
  }

  /**
   * Settings-page geometry, copied from the other sections: one 720px column,
   * a 16px/500 heading, 14px supporting copy, and a card per surface. Every
   * color is an alias token so the page follows the active theme; class names
   * carry the bundle prefix because this stylesheet is global, not a CSS module.
   */
  const STYLE = `
  .dsh-codex-quota-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 720px;
  }
  .dsh-codex-quota-title {
    margin: 0;
    font-size: 16px;
    font-weight: 500;
    line-height: 1.4;
    color: var(--dsw-alias-label-primary);
  }
  .dsh-codex-quota-intro {
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
    color: var(--dsw-alias-label-secondary);
  }
  .dsh-codex-quota-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 14px;
    background: var(--dsw-alias-settings-card-fill);
    border: 1px solid var(--dsw-alias-settings-card-stroke);
    border-radius: var(--dsw-radius-xl);
  }
  .dsh-codex-quota-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .dsh-codex-quota-identity {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .dsh-codex-quota-brand {
    font-size: 14px;
    font-weight: 600;
    color: var(--dsw-alias-label-primary);
  }
  .dsh-codex-quota-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    font-size: 13px;
    color: var(--dsw-alias-label-secondary);
  }
  .dsh-codex-quota-email {
    overflow-wrap: anywhere;
  }
  .dsh-codex-quota-dot {
    color: var(--dsw-alias-label-tertiary);
  }
  .dsh-codex-quota-refresh[aria-busy='true'] {
    opacity: 0.6;
  }
  .dsh-codex-quota-updated {
    font-size: 12px;
    color: var(--dsw-alias-label-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .dsh-codex-quota-windows {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .dsh-codex-quota-window {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .dsh-codex-quota-window-label {
    flex: none;
    min-width: 56px;
    font-size: 13px;
    color: var(--dsw-alias-label-primary);
  }
  .dsh-codex-quota-window-remaining {
    flex: none;
    min-width: 72px;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    color: var(--dsw-alias-label-secondary);
  }
  .dsh-codex-quota-progress {
    flex: 1 1 120px;
    min-width: 100px;
    height: 6px;
    overflow: hidden;
    background: var(--dsw-alias-interactive-bg-hover);
    border-radius: 999px;
  }
  .dsh-codex-quota-progress-fill {
    display: block;
    height: 100%;
    background: var(--dsw-alias-brand-primary);
    border-radius: inherit;
  }
  .dsh-codex-quota-progress[data-warn='true'] .dsh-codex-quota-progress-fill {
    background: var(--dsw-alias-state-warn-primary);
  }
  .dsh-codex-quota-reset {
    flex: none;
    margin-left: auto;
    font-size: 12px;
    color: var(--dsw-alias-label-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .dsh-codex-quota-divider {
    height: 1px;
    background: var(--dsw-alias-settings-card-stroke);
  }
  .dsh-codex-quota-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 0;
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    color: var(--dsw-alias-label-primary);
    text-align: left;
    background: none;
    border: 0;
    cursor: pointer;
  }
  .dsh-codex-quota-toggle:focus-visible {
    outline: 2px solid var(--dsw-alias-brand-primary);
    outline-offset: 2px;
  }
  .dsh-codex-quota-chevron {
    display: inline-block;
    color: var(--dsw-alias-label-tertiary);
    transition: transform 120ms ease;
  }
  .dsh-codex-quota-toggle[aria-expanded='true'] .dsh-codex-quota-chevron {
    transform: rotate(90deg);
  }
  .dsh-codex-quota-credit-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .dsh-codex-quota-credit {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .dsh-codex-quota-credit-copy {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .dsh-codex-quota-credit-title {
    font-size: 13px;
    color: var(--dsw-alias-label-primary);
  }
  .dsh-codex-quota-credit-expiry {
    font-size: 12px;
    color: var(--dsw-alias-label-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .dsh-codex-quota-credit-description {
    font-size: 12px;
    line-height: 1.4;
    color: var(--dsw-alias-label-secondary);
  }
  .dsh-codex-quota-credit-title[data-nearest='true'],
  .dsh-codex-quota-credit-expiry[data-nearest='true'] {
    font-weight: 600;
  }
  .dsh-codex-quota-warn {
    color: var(--dsw-alias-state-warn-primary);
  }
  .dsh-codex-quota-message {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--dsw-alias-label-secondary);
  }
  .dsh-codex-quota-detail {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    color: var(--dsw-alias-label-tertiary);
    overflow-wrap: anywhere;
  }
  .dsh-codex-quota-path {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    color: var(--dsw-alias-label-primary);
    overflow-wrap: anywhere;
  }
  .dsh-codex-quota-result {
    font-size: 13px;
    line-height: 1.5;
    color: var(--dsw-alias-state-success-primary);
  }
  .dsh-codex-quota-error {
    color: var(--dsw-alias-state-error-primary);
  }
  .dsh-codex-quota-confirm {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--dsw-alias-label-secondary);
  }
  .dsh-codex-quota-confirm p {
    margin: 0;
  }
  .dsh-codex-quota-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  `

  /** Replace `{name}` placeholders; missing parameters stay visible rather than turning into "undefined". */
  function translate(dict, key, params) {
    const template = dict[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match)
  }

  /** Chinese fallback translator for the pure helpers' default arguments. */
  const tZh = (key, params) => translate(zh, key, params)

  /** English translator used by the tests and by date formatting in an English UI. */
  const tEn = (key, params) => translate(en, key, params)

  /** Zero-pad a clock component. */
  function pad2(value) {
    return String(value).padStart(2, '0')
  }

  /**
   * Label a rate-limit window only as hours or days: the page shows planning
   * horizons, not the backend's exact second count.
   * @param limitSeconds - upstream `limit_window_seconds`, absent on some plans.
   * @param t - translator for the active namespace.
   * @returns "5 小时", "7 天", or the generic "窗口" fallback.
   */
  function windowLabel(limitSeconds, t = tZh) {
    if (typeof limitSeconds !== 'number' || !Number.isFinite(limitSeconds) || limitSeconds <= 0) {
      return t('windowFallback')
    }
    if (limitSeconds < DAY_SECONDS) {
      return t('hours', { count: Math.max(1, Math.round(limitSeconds / HOUR_SECONDS)) })
    }
    return t('days', { count: Math.max(1, Math.round(limitSeconds / SECONDS_PER_DAY)) })
  }

  /** Whether a locale tag wants Chinese date punctuation; every other language falls through to English. */
  function dateLanguage(locale) {
    return typeof locale === 'string' && locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  }

  /**
   * Format an instant the way the settings copy uses it: time-only on the
   * browser's current local day, with a date when the instant lies on another
   * day. The "重置"/"过期" suffix belongs to the surrounding sentence, so this
   * helper stays reusable by both labels.
   * @param at - instant in ms.
   * @param now - reference instant in ms.
   * @param t - translator carrying the date-time pattern.
   * @param locale - active locale tag, used only to choose numeric vs. month-name dates.
   * @returns "HH:mm" or "M 月 D 日 HH:mm" / "MMM D, HH:mm".
   */
  function formatInstant(at, now, t, locale) {
    const date = new Date(at)
    const current = new Date(now)
    const sameDay = date.getFullYear() === current.getFullYear()
      && date.getMonth() === current.getMonth()
      && date.getDate() === current.getDate()
    const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    if (sameDay) return time
    const chinese = dateLanguage(locale) === 'zh'
    return t('dateTime', {
      month: chinese ? String(date.getMonth() + 1) : EN_MONTHS[date.getMonth()],
      day: date.getDate(),
      time,
    })
  }

  /**
   * The reset instant as shown beside a window.
   * @param resetsAt - upstream reset instant in ms.
   * @param now - current instant in ms.
   * @param t - translator.
   * @param locale - active locale tag.
   * @returns the timestamp portion, without the trailing "重置".
   */
  function resetLabel(resetsAt, now = Date.now(), t = tZh, locale = 'zh') {
    return formatInstant(resetsAt, now, t, locale)
  }

  /**
   * A credit's expiry timestamp, without the surrounding "券于 … 过期" sentence.
   * @param expiresAt - credit expiry in ms.
   * @param now - current instant in ms.
   * @param t - translator.
   * @param locale - active locale tag.
   * @returns the timestamp portion.
   */
  function expiryLabel(expiresAt, now = Date.now(), t = tZh, locale = 'zh') {
    return formatInstant(expiresAt, now, t, locale)
  }

  /** `HH:mm:ss` for the "updated at" line. */
  function clockLabel(at) {
    const date = new Date(at)
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  }

  /** A usable expiry instant, or Infinity for "no date" / a malformed one (sorts last). */
  function expiryOf(item) {
    return typeof item?.expiresAt === 'number' && Number.isFinite(item.expiresAt)
      ? item.expiresAt
      : Number.POSITIVE_INFINITY
  }

  /**
   * Copy and order credits by expiry, undated ones last. The Host already
   * sorts, but the page tolerates a reordered response and Array#sort keeps
   * equal timestamps in their original (first-in-list) order.
   * @param items - the `credits.items` array.
   * @returns a new array; the input is never mutated.
   */
  function sortCredits(items) {
    return [...items].sort((left, right) => expiryOf(left) - expiryOf(right))
  }

  /**
   * Project which credit deserves emphasis. "Nearest" is the strictly earliest
   * dated credit (the first one on a tie); "expiring soon" is any credit whose
   * expiry is at most seven days away, including an already-expired one.
   * @param items - credits in any order.
   * @param now - current instant in ms.
   * @returns the nearest id (undefined when every credit is undated) and the ids needing warn color.
   */
  function creditDecorations(items, now = Date.now()) {
    const sorted = sortCredits(items)
    const nearest = sorted.find(item => expiryOf(item) !== Number.POSITIVE_INFINITY)
    const expiringSoonIds = sorted
      .filter(item => expiryOf(item) !== Number.POSITIVE_INFINITY && expiryOf(item) - now <= EXPIRING_SOON_MS)
      .map(item => item.id)
    return { nearestId: nearest?.id, expiringSoonIds }
  }

  /**
   * The remaining percentage as an integer, so the text and the fill width
   * describe the same number. A missing/malformed value means "nothing used".
   * @param window - one quota window.
   * @returns 0..100, rounded.
   */
  function remainingPercentOf(window) {
    const value = typeof window?.remainingPercent === 'number' && Number.isFinite(window.remainingPercent)
      ? window.remainingPercent
      : 100
    return Math.min(100, Math.max(0, Math.round(value)))
  }

  /**
   * The copy for one redemption outcome.
   * @param outcome - one of the Host's four outcomes.
   * @param windowsReset - how many windows the Host reported reset.
   * @param t - translator.
   * @returns a non-empty sentence.
   */
  function outcomeText(outcome, windowsReset, t = tZh) {
    if (outcome === 'reset') {
      return typeof windowsReset === 'number' && Number.isFinite(windowsReset)
        ? t('outcomeReset', { count: windowsReset })
        : t('outcomeResetNoCount')
    }
    if (outcome === 'nothing-to-reset') return t('outcomeNothingToReset')
    if (outcome === 'no-credit') return t('outcomeNoCredit')
    if (outcome === 'already-redeemed') return t('outcomeAlreadyRedeemed')
    return t('outcomeUnknown')
  }

  /**
   * The window clause of the confirmation sentence.
   * @param windows - the snapshot's windows.
   * @param t - translator.
   * @returns comma-separated "5 小时（剩余 95%）" pieces, or an empty string.
   */
  function windowSummary(windows, t) {
    return windows.map(window => t('windowWithRemaining', {
      label: windowLabel(window.limitSeconds, t),
      percent: remainingPercentOf(window),
    })).join(t('listSeparator'))
  }

  /** Combine a base class with the low/warn modifier without a classnames dependency. */
  function withWarn(className, warn) {
    return warn ? `${className} dsh-codex-quota-warn` : className
  }

  window.__ModuleLoader__.load({
    id: '@local/dsh-codex-live',
    factory(require) {
      const React = require('react')
      const { Modal, Button } = require('@deepseek-ai/dsh-client-ui-primitives')
      const h = React.createElement

      /**
       * The Codex quota page.
       * @param props - the settings-section runtime props, localized `t`, and the
       *   injected `getLocale` reader (used only for month-name date formatting).
       * @returns the section shell, the snapshot card, and the confirmation modal.
       */
      function CodexQuotaPage(props) {
        const { t, getLocale } = props
        const locale = typeof getLocale === 'function' ? getLocale() : undefined
        const [view, setView] = React.useState(undefined)
        const [busy, setBusy] = React.useState(true)
        const [requestFailed, setRequestFailed] = React.useState(false)
        const [expanded, setExpanded] = React.useState(false)
        const [confirm, setConfirm] = React.useState(undefined)
        const [result, setResult] = React.useState(undefined)
        const [now, setNow] = React.useState(() => Date.now())
        const sequence = React.useRef(0)
        const controller = React.useRef(undefined)
        const groupId = React.useId()

        /**
         * Read one snapshot. The Host answers every domain outcome with 200, so
         * only a transport failure or a non-2xx reaches the catch; a later request
         * (or unmount) supersedes an earlier one by sequence number, which also
         * keeps a slow refresh from overwriting a newer one.
         * @param refresh - whether to append `?refresh=1`, bypassing both Host caches.
         */
        const readQuota = async (refresh) => {
          const id = sequence.current + 1
          sequence.current = id
          controller.current?.abort()
          const next = new AbortController()
          controller.current = next
          setBusy(true)
          setRequestFailed(false)
          try {
            const response = await fetch(`${QUOTA_URL}${refresh ? '?refresh=1' : ''}`, {
              signal: next.signal,
              cache: 'no-store',
              headers: { accept: 'application/json' },
            })
            if (!response.ok) throw new Error(`codex-live: quota HTTP ${response.status}`)
            const body = await response.json()
            if (body === null || typeof body !== 'object' || typeof body.status !== 'string') {
              throw new Error('codex-live: quota response carried no status')
            }
            if (sequence.current !== id) return
            setView(body)
            setNow(Date.now())
            setBusy(false)
          } catch (error) {
            if (sequence.current !== id || error?.name === 'AbortError') return
            setRequestFailed(true)
            setBusy(false)
          }
        }

        React.useEffect(() => {
          void readQuota(false)
          return () => {
            sequence.current += 1
            controller.current?.abort()
          }
          // Mount-only by design: no polling and no focus refresh.
        }, [])

        /** A user-initiated read; every retry path means "ask the Host again". */
        const refresh = () => { void readQuota(true) }

        /** Open the confirmation with a fresh idempotency key; retries inside the dialog reuse it. */
        const openConfirm = (credit) => {
          setConfirm({
            credit,
            redeemRequestId: globalThis.crypto.randomUUID(),
            submitting: false,
            failed: false,
          })
        }

        /** Close the dialog unless a redemption is in flight; closing discards the key. */
        const closeConfirm = () => {
          if (confirm?.submitting) return
          setConfirm(undefined)
        }

        /**
         * Spend the confirmed credit. The outcome is displayed as a result line,
         * then an ordinary read (no `refresh`) picks up the Host's post-consume
         * cache state. A failure keeps the dialog and its idempotency key alive for
         * a retry.
         */
        const submitConfirm = async () => {
          if (confirm === undefined || confirm.submitting) return
          const current = confirm
          setConfirm({ ...current, submitting: true, failed: false })
          try {
            const response = await fetch(CONSUME_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ redeemRequestId: current.redeemRequestId, creditId: current.creditId }),
            })
            if (!response.ok) throw new Error(`codex-live: consume HTTP ${response.status}`)
            const body = await response.json()
            // Keep the raw outcome so the line follows the active locale if it changes.
            setResult({ outcome: body?.outcome, windowsReset: body?.windowsReset })
            setConfirm(undefined)
            void readQuota(false)
          } catch {
            setConfirm(previous => previous === undefined
              ? undefined
              : { ...previous, submitting: false, failed: true })
          }
        }

        const ok = view?.status === 'ok' ? view : undefined
        const credits = ok?.credits
        const items = credits?.items
        const sorted = Array.isArray(items) ? sortCredits(items) : []
        const decorations = creditDecorations(sorted, now)
        const nearestCredit = decorations.nearestId === undefined
          ? undefined
          : sorted.find(item => item.id === decorations.nearestId)
        const expiringSoon = new Set(decorations.expiringSoonIds)

        /** One retry/message block shared by the request and domain error states. */
        const notice = (lines, options = {}) => h(
          'div',
          { className: 'dsh-codex-quota-message', role: 'status', 'aria-live': 'polite' },
          ...lines.map((line, index) => h('span', { key: String(index) }, line)),
          options.detail !== undefined && h('span', { className: 'dsh-codex-quota-detail' }, options.detail),
          typeof options.path === 'string'
            && h('span', { className: 'dsh-codex-quota-path' }, t('credentialFile', { path: options.path })),
          options.codexHint === true && h('span', null, t('runCodex')),
          options.retry !== false && h(Button, {
            variant: 'outline',
            size: 'sm',
            onClick: refresh,
            disabled: busy,
          }, t('retry')),
        )

        /** The window rows: label, remaining text, used-fill progress, reset instant. */
        const renderWindow = (window, index) => {
          const remaining = remainingPercentOf(window)
          const used = 100 - remaining
          const low = remaining <= LOW_REMAINING_PERCENT
          const remainingLabel = t('remainingPercent', { percent: remaining })
          return h(
            'div',
            { key: `${index}-${window.limitSeconds ?? 'window'}`, className: 'dsh-codex-quota-window' },
            h('span', { className: 'dsh-codex-quota-window-label' }, windowLabel(window.limitSeconds, t)),
            h('span', { className: withWarn('dsh-codex-quota-window-remaining', low) }, remainingLabel),
            h(
              'div',
              {
                className: 'dsh-codex-quota-progress',
                role: 'progressbar',
                'aria-valuemin': 0,
                'aria-valuemax': 100,
                'aria-valuenow': used,
                'aria-label': remainingLabel,
                'data-warn': low ? 'true' : undefined,
              },
              h('span', { className: 'dsh-codex-quota-progress-fill', style: { width: `${used}%` } }),
            ),
            window.resetsAt !== undefined && h(
              'span',
              { className: 'dsh-codex-quota-reset' },
              t('resetAt', { time: resetLabel(window.resetsAt, now, t, locale) }),
            ),
          )
        }

        /** The expanded credit region: unknown details, empty state, or the sorted list. */
        const renderCredits = () => {
          if (items === null) {
            return h(
              'div',
              { className: 'dsh-codex-quota-message' },
              h('span', null, t('creditsUnavailable', { count: credits.availableCount })),
              h(Button, { variant: 'outline', size: 'sm', onClick: refresh, disabled: busy }, t('retry')),
            )
          }
          if (sorted.length === 0) {
            return h(
              'div',
              { className: 'dsh-codex-quota-message' },
              h('span', null, t('creditsEmpty')),
              credits.availableCount > 0 && h(Button, {
                variant: 'outline',
                size: 'sm',
                onClick: refresh,
                disabled: busy,
              }, t('refresh')),
            )
          }
          return h(
            'div',
            { className: 'dsh-codex-quota-credit-list' },
            sorted.map((credit) => {
              const nearest = credit.id === decorations.nearestId
              const warn = expiringSoon.has(credit.id)
              return h(
                'div',
                { key: credit.id, className: 'dsh-codex-quota-credit' },
                h(
                  'div',
                  { className: 'dsh-codex-quota-credit-copy' },
                  h(
                    'span',
                    {
                      className: 'dsh-codex-quota-credit-title',
                      'data-nearest': nearest ? 'true' : undefined,
                    },
                    credit.title.length > 0 ? credit.title : t('creditFallback'),
                    nearest && h('span', { className: 'dsh-codex-quota-sr' }, t('nearestExpiry')),
                  ),
                  credit.description !== undefined
                    && h('span', { className: 'dsh-codex-quota-credit-description' }, credit.description),
                  h(
                    'span',
                    {
                      className: withWarn('dsh-codex-quota-credit-expiry', warn),
                      'data-nearest': nearest ? 'true' : undefined,
                    },
                    credit.expiresAt === undefined
                      ? t('neverExpires')
                      : t('expiryAt', { time: expiryLabel(credit.expiresAt, now, t, locale) }),
                  ),
                ),
                h(Button, {
                  variant: 'outline',
                  size: 'sm',
                  onClick: () => { openConfirm(credit) },
                }, t('use')),
              )
            }),
          )
        }

        /** The second-confirmation dialog, including the "earlier credit" advisory. */
        const renderConfirm = () => {
          if (confirm === undefined) return null
          const credit = confirm.credit
          const hasEarlier = nearestCredit !== undefined
            && credit.expiresAt !== undefined
            && nearestCredit.expiresAt !== undefined
            && credit.expiresAt > nearestCredit.expiresAt
          const expirySoon = credit.expiresAt !== undefined
            && credit.expiresAt - now <= EXPIRING_SOON_MS
          const windows = ok?.windows ?? []
          const summary = windowSummary(windows, t)
          return h(
            Modal,
            {
              open: true,
              onClose: closeConfirm,
              title: t('confirmTitle'),
              closeLabel: t('close'),
              footer: h(
                React.Fragment,
                null,
                h(Button, {
                  variant: 'outline',
                  onClick: closeConfirm,
                  disabled: confirm.submitting,
                }, t('cancel')),
                h(Button, {
                  variant: 'primary',
                  onClick: () => { void submitConfirm() },
                  disabled: confirm.submitting,
                  'aria-busy': confirm.submitting || undefined,
                }, confirm.submitting ? t('redeeming') : t('redeem')),
              ),
            },
            h(
              'div',
              { className: 'dsh-codex-quota-confirm' },
              h('p', null, summary.length > 0 ? t('confirmBody', { windows: summary }) : t('confirmBodyGeneric')),
              credit.expiresAt !== undefined && h('p', {
                className: expirySoon ? 'dsh-codex-quota-warn' : undefined,
              }, t('expirySentence', { time: expiryLabel(credit.expiresAt, now, t, locale) })),
              hasEarlier && h('p', { className: 'dsh-codex-quota-warn' },
                t('confirmEarlier', { time: expiryLabel(nearestCredit.expiresAt, now, t, locale) })),
              confirm.failed && h('p', {
                className: 'dsh-codex-quota-error',
                role: 'status',
                'aria-live': 'polite',
              }, t('redeemFailed')),
            ),
          )
        }

        /** Everything the card shows while no snapshot is available yet. */
        const renderUnavailable = () => {
          if (requestFailed) return notice([t('requestFailed')])
          if (view === undefined) return notice([t('loading')], { retry: false })
          if (view.status === 'no-credential') {
            return notice([t('noCredential')], { path: authPathOf(view), codexHint: true })
          }
          if (view.status === 'token-expired') {
            return notice([t('tokenExpired')], { path: authPathOf(view), codexHint: true })
          }
          if (view.status === 'no-plan') return notice([t('noPlan')])
          if (view.status === 'upstream-error') {
            return notice([t('upstreamError')], { detail: typeof view.detail === 'string' ? view.detail : undefined })
          }
          return notice([t('requestFailed')])
        }

        /** The full account card once the Host returned an `ok` snapshot. */
        const renderOk = () => h(
          'div',
          { className: 'dsh-codex-quota-card' },
          h(
            'div',
            { className: 'dsh-codex-quota-head' },
            h(
              'div',
              { className: 'dsh-codex-quota-identity' },
              h('span', { className: 'dsh-codex-quota-brand' }, 'OpenAI Codex (live)'),
              (ok.plan.length > 0 || ok.email.length > 0) && h(
                'span',
                { className: 'dsh-codex-quota-meta' },
                ok.plan.length > 0 && h('span', { key: 'plan' }, ok.plan),
                ok.plan.length > 0 && ok.email.length > 0
                  && h('span', { key: 'dot', className: 'dsh-codex-quota-dot', 'aria-hidden': true }, '·'),
                ok.email.length > 0 && h('span', {
                  key: 'email',
                  className: 'dsh-codex-quota-email',
                  title: ok.email,
                }, ok.email),
              ),
            ),
            h(Button, {
              variant: 'outline',
              size: 'sm',
              className: 'dsh-codex-quota-refresh',
              onClick: refresh,
              disabled: busy,
              'aria-busy': busy || undefined,
            }, t('refresh')),
          ),
          h('span', {
            className: 'dsh-codex-quota-updated',
            role: 'status',
            'aria-live': 'polite',
          }, t('updatedAt', { time: clockLabel(ok.fetchedAt) })),
          result !== undefined && h('div', {
            className: 'dsh-codex-quota-result',
            role: 'status',
            'aria-live': 'polite',
          }, outcomeText(result.outcome, result.windowsReset, t)),
          h('div', { className: 'dsh-codex-quota-windows' }, ok.windows.map(renderWindow)),
          h('div', { className: 'dsh-codex-quota-divider' }),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-codex-quota-toggle',
              id: `${groupId}-toggle`,
              'aria-expanded': expanded,
              'aria-controls': `${groupId}-credits`,
              onClick: () => { setExpanded(value => !value) },
            },
            h('span', { className: 'dsh-codex-quota-chevron', 'aria-hidden': true }, '▸'),
            h('span', null, t('creditsToggle', { count: credits.availableCount })),
          ),
          expanded && h(
            'div',
            {
              id: `${groupId}-credits`,
              role: 'group',
              'aria-labelledby': `${groupId}-toggle`,
            },
            renderCredits(),
          ),
          renderConfirm(),
        )

        return h(
          React.Fragment,
          null,
          h('style', null, STYLE),
          h(
            'section',
            { className: 'dsh-codex-quota-section', 'aria-label': t('nav') },
            h('h2', { className: 'dsh-codex-quota-title' }, t('nav')),
            h('p', { className: 'dsh-codex-quota-intro' }, t('intro')),
            ok !== undefined
              ? renderOk()
              : h('div', { className: 'dsh-codex-quota-card' }, renderUnavailable()),
          ),
        )
      }


      return {
        inject: ['slots', 'locale'],
        apply(ctx) {
          const t = ctx.locale.bind(NS)
          ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'codex-live: quota dictionaries')
          ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section',
            id: 'codex-quota',
            order: -5,
            label: () => t('nav'),
            locale: NS,
            // The section label and the page copy follow the slot's locale seat;
            // this reader only lets date formatting pick month names.
            inject: () => ({ getLocale: () => ctx.locale.getSnapshot().active }),
          }, CodexQuotaPage))
        },
        // Extra test surface only: Cordis ignores unknown factory fields.
        __test: {
          windowLabel,
          resetLabel,
          expiryLabel,
          creditDecorations,
          remainingPercentOf,
          outcomeText,
          authPathOf,
          sortCredits,
          windowSummary,
          zh,
          en,
          tEn,
        },
      }
    },
  })
})()
