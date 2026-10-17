// Browser half: one composer-dock pill showing the current workspace's git
// state (branch, staged/unstaged/untracked/conflicted, ahead/behind) and, for
// GitHub remotes, the branch's pull request.
//
// Data comes from the host half's loopback route:
//   GET /dsh-plugin/workspace-status?dir=<absolute cwd>
// The pill polls every 15s while the page is visible and refreshes on focus.
window.__ModuleLoader__.load({
  id: 'dsh-workspace-status',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const e = React.createElement

    const FONT = 'var(--dsw-content-font-size-secondary, 12px)'
    const MUTED = 'var(--dsw-alias-label-tertiary, #8a8a90)'
    const TEXT = 'var(--dsw-alias-label-secondary, #6b6b72)'
    const GREEN = '#2f8a4a'
    const AMBER = '#b26a00'
    const RED = '#c0392b'
    const PURPLE = '#7b4fc9'

    const pillStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '1px 8px',
      borderRadius: '999px',
      border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.24))',
      background: 'transparent',
      color: TEXT,
      fontFamily: 'inherit',
      fontSize: FONT,
      lineHeight: '18px',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
      cursor: 'default',
      maxWidth: '420px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }

    function sep() {
      return e('span', { key: 'sep', style: { color: MUTED, opacity: 0.6 }, 'aria-hidden': true }, '·')
    }

    function count(key, label, n, color) {
      if (n <= 0) return null
      return e('span', { key, style: { color }, title: label }, `${label}${n}`)
    }

    function prChip(pr) {
      if (pr === null || pr === undefined) return null
      const draft = pr.isDraft === true
      const state = String(pr.state ?? '').toUpperCase()
      const color = draft ? MUTED : state === 'OPEN' ? GREEN : state === 'MERGED' ? PURPLE : state === 'CLOSED' ? RED : MUTED
      const text = draft ? `#${pr.number} draft` : `#${pr.number} ${state.toLowerCase()}`
      const open = typeof pr.url === 'string' && pr.url.startsWith('https://')
      return e('span', {
        key: 'pr',
        style: { color, fontWeight: 600, cursor: open ? 'pointer' : 'default' },
        title: `${pr.title ?? ''}`,
        onClick: open
          ? (event) => { event.preventDefault(); event.stopPropagation(); window.open(pr.url, '_blank', 'noopener') }
          : undefined,
      }, text)
    }

    function GitStatusPill(props) {
      const cwd = props.useSessions((sessions) => {
        if (props.sessionId === undefined) return undefined
        return sessions.byId[props.sessionId]?.cwd
      })
      const [data, setData] = React.useState(null)

      React.useEffect(() => {
        if (!cwd) { setData(null); return undefined }
        let alive = true
        const load = () => {
          fetch(`/dsh-plugin/workspace-status?dir=${encodeURIComponent(cwd)}`, { credentials: 'same-origin' })
            .then((res) => res.ok ? res.json() : null)
            .then((json) => { if (alive) setData(json) })
            .catch(() => { if (alive) setData(null) })
        }
        load()
        const timer = window.setInterval(() => {
          if (document.visibilityState === 'visible') load()
        }, 15000)
        const onFocus = () => load()
        window.addEventListener('focus', onFocus)
        return () => {
          alive = false
          window.clearInterval(timer)
          window.removeEventListener('focus', onFocus)
        }
      }, [cwd])

      if (!cwd || data === null || data.ok !== true) return null
      const repo = data.repo
      const changes = data.changes
      const parts = []
      parts.push(e('span', {
        key: 'branch',
        style: { color: repo.detached ? AMBER : TEXT, fontWeight: 500 },
        title: repo.root,
      }, `⎇ ${repo.branch}${repo.detached ? ' (detached)' : ''}`))

      const dirty = []
      dirty.push(count('staged', '+', changes.staged, GREEN))
      dirty.push(count('unstaged', '~', changes.unstaged, AMBER))
      dirty.push(count('untracked', '?', changes.untracked, MUTED))
      dirty.push(count('conflicted', '!', changes.conflicted, RED))
      const visibleDirty = dirty.filter((node) => node !== null)
      if (visibleDirty.length > 0) {
        parts.push(sep())
        parts.push(e('span', { key: 'dirty', style: { display: 'inline-flex', gap: '5px' } }, visibleDirty))
      }
      if (changes.ahead > 0 || changes.behind > 0) {
        parts.push(sep())
        if (changes.ahead > 0) parts.push(e('span', { key: 'ahead', style: { color: GREEN }, title: 'ahead' }, `↑${changes.ahead}`))
        if (changes.behind > 0) parts.push(e('span', { key: 'behind', style: { color: AMBER }, title: 'behind' }, `↓${changes.behind}`))
      }
      if (repo.github !== null) {
        parts.push(sep())
        parts.push(prChip(data.pr))
        if (data.pr === null || data.pr === undefined) {
          parts.push(e('span', { key: 'nopr', style: { color: MUTED } }, 'no PR'))
        }
      }

      const title = [
        repo.root,
        repo.github !== null ? `GitHub: ${repo.github}` : 'no GitHub remote',
        repo.branch,
      ].join('\n')
      return e('span', { style: pillStyle, title, 'data-git-pill': '1' }, parts)
    }

    function apply(ctx) {
      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'git-status',
        order: 2,
      }, GitStatusPill))
    }

    exports.name = 'dsh-workspace-status'
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
