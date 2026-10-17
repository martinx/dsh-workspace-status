// Browser half: composer-dock pill for git/GitHub workspace state.
//
// Clicking the pills opens panels:
//   branch  → local branch list, click to `git switch`
//   changes → changed-file list, click a file for its unified diff
//   PR      → PR summary, review/mergeable state, GitHub Actions checks
//
// Data comes from the host half:
//   GET  /dsh-plugin/workspace-status
//   GET  /dsh-plugin/git-branches
//   GET  /dsh-plugin/git-changes
//   GET  /dsh-plugin/git-diff
//   POST /dsh-plugin/git-switch
window.__ModuleLoader__.load({
  id: 'dsh-workspace-status',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const ReactDOM = require('react-dom')
    const e = React.createElement

    const STYLE_ID = 'dsh-workspace-status-style'
    const TEXT = 'var(--dsw-alias-label-secondary, #6b6b72)'
    const PRIMARY = 'var(--dsw-alias-label-primary, #1c1c1e)'
    const MUTED = 'var(--dsw-alias-label-tertiary, #8a8a90)'
    const GREEN = '#2f8a4a'
    const AMBER = '#b26a00'
    const RED = '#c0392b'
    const PURPLE = '#7b4fc9'

    const CSS = `
.dshws-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 1px 8px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.24));
  background: transparent; color: ${TEXT};
  font-family: inherit; font-size: 12px; line-height: 18px;
  font-variant-numeric: tabular-nums; white-space: nowrap;
  cursor: default; max-width: 520px;
}
.dshws-pill button {
  appearance: none; -webkit-appearance: none;
  background: transparent; border: 0; padding: 0; margin: 0;
  color: inherit; font: inherit; line-height: inherit;
  display: inline-flex; align-items: center; gap: 4px;
  cursor: pointer; border-radius: 6px;
}
.dshws-pill button:hover { color: var(--dsw-alias-label-primary, #1c1c1e); }
.dshws-pill button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #5686fe); outline-offset: 1px; }
.dshws-sep { color: ${MUTED}; opacity: 0.55; }
.dshws-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.dshws-panel {
  position: fixed; z-index: 2147483000;
  display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-layer-2, #ffffff);
  color: var(--dsw-alias-label-primary, #1c1c1e);
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12));
  border-radius: 14px; box-shadow: 0 18px 48px rgba(0,0,0,0.24);
  font-family: inherit; font-size: 12.5px; line-height: 1.5;
  overflow: hidden;
}
.dshws-head {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06));
}
.dshws-title { font-weight: 600; color: ${PRIMARY}; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshws-icon {
  appearance: none; background: transparent; border: 0; cursor: pointer;
  color: ${MUTED}; font-size: 15px; line-height: 1; padding: 3px 6px; border-radius: 6px;
}
.dshws-icon:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.12)); color: ${PRIMARY}; }
.dshws-body { overflow: auto; padding: 6px; }
.dshws-loading { padding: 6px 12px; color: ${MUTED}; }
.dshws-error { margin: 6px; padding: 8px 10px; border-radius: 8px; background: rgba(192,57,43,0.10); color: ${RED}; font-size: 12px; word-break: break-word; }
.dshws-empty { padding: 14px 12px; color: ${MUTED}; font-size: 12px; }
.dshws-section { padding: 8px 8px 4px; color: ${MUTED}; font-size: 11px; letter-spacing: 0.06em; }
.dshws-row {
  appearance: none; -webkit-appearance: none; width: 100%; text-align: left;
  display: flex; align-items: center; gap: 8px;
  background: transparent; border: 0; cursor: pointer;
  padding: 6px 8px; border-radius: 8px; color: ${PRIMARY}; font: inherit;
}
.dshws-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.12)); }
.dshws-row.current { background: var(--dsw-alias-button-ghost-active-fill, rgba(86,134,254,0.12)); }
.dshws-row.static { cursor: default; }
.dshws-row.static:hover { background: transparent; }
.dshws-branch { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshws-muted { margin-left: auto; color: ${MUTED}; font-size: 11px; white-space: nowrap; }
.dshws-tag {
  font-size: 10px; padding: 1px 6px; border-radius: 999px;
  background: var(--dsw-alias-state-business-tertiary, rgba(86,134,254,0.14));
  color: var(--dsw-alias-brand-primary, #5686fe); white-space: nowrap;
}
.dshws-badge {
  flex: 0 0 auto; min-width: 18px; text-align: center;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; font-weight: 600;
}
.dshws-file { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
.dshws-filewrap { min-width: 0; flex: 1; }
.dshws-diff {
  margin: 0; padding: 8px 6px; overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; line-height: 1.55;
  white-space: pre; color: ${PRIMARY};
}
.dshws-diff .add { color: ${GREEN}; background: rgba(47,138,74,0.10); }
.dshws-diff .del { color: ${RED}; background: rgba(192,57,43,0.10); }
.dshws-diff .hunk { color: var(--dsw-alias-brand-primary, #5686fe); }
.dshws-diff .meta { color: ${MUTED}; }
.dshws-pr-title { font-weight: 600; color: ${PRIMARY}; text-decoration: none; display: block; padding: 2px 2px 8px; word-break: break-word; }
.dshws-pr-title:hover { text-decoration: underline; }
.dshws-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 2px 10px; }
.dshws-chip { font-size: 10.5px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.14)); color: ${TEXT}; }
.dshws-check { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 8px; }
.dshws-check:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.12)); }
.dshws-check a { color: inherit; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshws-check a:hover { text-decoration: underline; }
.dshws-check-state { margin-left: auto; color: ${MUTED}; font-size: 10.5px; white-space: nowrap; }
.dshws-actions { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06)); }
.dshws-action {
  appearance: none; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.14));
  background: transparent; color: ${PRIMARY}; font: inherit; font-size: 12px;
  padding: 5px 12px; border-radius: 999px; cursor: pointer; text-decoration: none;
}
.dshws-action:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.12)); }
.dshws-action.primary { background: var(--dsw-alias-brand-primary, #5686fe); border-color: transparent; color: #fff; }
.dshws-action.primary:hover { filter: brightness(1.05); }
.dshws-path { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary, #1c1c1e); }
.dshws-env { font-size: 10.5px; color: var(--dsw-alias-label-tertiary, #8a8a90); background: rgba(128,128,128,0.10); padding: 0 5px; border-radius: 4px; white-space: nowrap; }
.dshws-floating { gap: 5px; }
`

    let styleInstalled = false
    function installStyle() {
      if (styleInstalled || typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) { styleInstalled = true; return }
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
      styleInstalled = true
    }

    async function getJson(url) {
      const res = await fetch(url, { credentials: 'same-origin' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    }

    async function postJson(url, body) {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    }

    function stateColor(state) {
      const value = String(state || '').toUpperCase()
      if (value === 'OPEN') return GREEN
      if (value === 'MERGED') return PURPLE
      if (value === 'CLOSED') return RED
      return MUTED
    }

    function statusColor(file) {
      if (file.conflicted) return RED
      if (file.untracked) return MUTED
      if (file.staged) return GREEN
      return AMBER
    }

    function statusLabel(file) {
      if (file.conflicted) return '冲突'
      if (file.untracked) return '新增'
      if (file.status === 'R' || file.status === 'C') return '重命名'
      if (file.status.includes('D')) return '删除'
      if (file.staged && !file.unstaged) return '已暂存'
      if (file.unstaged && !file.staged) return '未暂存'
      return '已修改'
    }

    function checkDot(bucket) {
      const color = bucket === 'pass' ? GREEN : bucket === 'fail' ? RED : AMBER
      return e('span', { className: 'dshws-dot', style: { background: color } })
    }

    function prStateLabel(pr) {
      if (pr.isDraft) return 'draft'
      return String(pr.state || '').toLowerCase()
    }

    function moneyText(amount, currency) {
      const symbol = currency === 'USD' ? '$' : '¥'
      const value = Number(amount)
      if (!Number.isFinite(value)) return `${symbol}${String(amount)}`
      if (value === 0) return `${symbol}0.00`
      if (value > 0 && value < 0.01) return `<${symbol}0.01`
      return `${symbol}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }

    function balanceTitle(wallets, bonusWallets) {
      const lines = []
      for (const wallet of wallets) lines.push(`充值余额：${moneyText(wallet.balance, wallet.currency)}`)
      for (const wallet of bonusWallets) lines.push(`赠送余额：${moneyText(wallet.balance, wallet.currency)}`)
      lines.push('点击打开 DeepSeek 用量与充值页面')
      return lines.join('\n')
    }

    function WorkspaceStatusPill(props) {
      const cwd = props.useSessions((sessions) => {
        if (props.sessionId === undefined) return undefined
        return sessions.byId[props.sessionId]?.cwd
      })
      const [data, setData] = React.useState(null)
      const [panel, setPanel] = React.useState(null)
      const [rect, setRect] = React.useState(null)
      const [branches, setBranches] = React.useState(null)
      const [changes, setChanges] = React.useState(null)
      const [diff, setDiff] = React.useState(null)
      const [panelError, setPanelError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [balance, setBalance] = React.useState(null)
      const pillRef = React.useRef(null)
      const dockRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const loadBalanceRef = React.useRef(props.loadBalance)
      loadBalanceRef.current = props.loadBalance
      const hasStatus = data !== null && data.ok === true

      const load = React.useCallback(() => {
        if (!cwd) { setData(null); return }
        getJson(`/dsh-plugin/workspace-status?dir=${encodeURIComponent(cwd)}`)
          .then((json) => setData(json))
          .catch(() => setData(null))
      }, [cwd])

      React.useEffect(() => {
        load()
        const timer = window.setInterval(() => {
          if (document.visibilityState === 'visible') load()
        }, 15000)
        const onFocus = () => load()
        window.addEventListener('focus', onFocus)
        return () => {
          window.clearInterval(timer)
          window.removeEventListener('focus', onFocus)
        }
      }, [load])

      React.useEffect(() => {
        let alive = true
        const loadBalance = () => {
          const fn = loadBalanceRef.current
          if (typeof fn !== 'function') return
          fn().then((value) => { if (alive) setBalance(value) }).catch(() => {})
        }
        loadBalance()
        const timer = window.setInterval(() => {
          if (document.visibilityState === 'visible') loadBalance()
        }, 600000)
        const onFocus = () => loadBalance()
        window.addEventListener('focus', onFocus)
        return () => {
          alive = false
          window.clearInterval(timer)
          window.removeEventListener('focus', onFocus)
        }
      }, [])

      React.useEffect(() => {
        if (panel === null) return undefined
        const close = () => setPanel(null)
        const onDown = (event) => {
          if (pillRef.current !== null && pillRef.current.contains(event.target)) return
          if (panelRef.current !== null && panelRef.current.contains(event.target)) return
          setPanel(null)
        }
        const onKey = (event) => { if (event.key === 'Escape') setPanel(null) }
        const onScroll = (event) => {
          if (panelRef.current !== null && event.target instanceof Node && panelRef.current.contains(event.target)) return
          setPanel(null)
        }
        document.addEventListener('mousedown', onDown, true)
        document.addEventListener('keydown', onKey)
        window.addEventListener('resize', close)
        window.addEventListener('scroll', onScroll, true)
        return () => {
          document.removeEventListener('mousedown', onDown, true)
          document.removeEventListener('keydown', onKey)
          window.removeEventListener('resize', close)
          window.removeEventListener('scroll', onScroll, true)
        }
      }, [panel])

      // The composer dock centers its entries. Left-align the row to the
      // dialog's left edge and order this pill first, so status sits directly
      // under the input box instead of floating in the middle.
      React.useEffect(() => {
        const align = () => {
          const pill = pillRef.current
          if (pill === null) return
          const dock = pill.closest('[class*="_dock"]')
          if (dock === null) return
          dockRef.current = dock
          const root = dock.parentElement
          if (root === null) return
          const rootStyle = getComputedStyle(root)
          const rootLeft = root.getBoundingClientRect().left + (parseFloat(rootStyle.paddingLeft) || 0)
          const dialog = root.firstElementChild
          const inset = dialog === null ? 0 : Math.max(0, Math.round(dialog.getBoundingClientRect().left - rootLeft))
          // border-box keeps width:100% from growing by the padding, which
          // would shift the whole row left by half the padding.
          dock.style.boxSizing = 'border-box'
          dock.style.width = '100%'
          dock.style.justifyContent = 'flex-start'
          dock.style.paddingLeft = `${inset}px`
        }
        align()
        const timeout = window.setTimeout(align, 120)
        const interval = window.setInterval(align, 3000)
        window.addEventListener('resize', align)
        let observer = null
        try {
          observer = new ResizeObserver(align)
          observer.observe(document.body)
        } catch {
          // ResizeObserver is optional; the interval still keeps the layout fresh.
        }
        return () => {
          window.clearTimeout(timeout)
          window.clearInterval(interval)
          window.removeEventListener('resize', align)
          if (observer !== null) observer.disconnect()
          const dock = dockRef.current
          if (dock !== null) {
            dock.style.boxSizing = ''
            dock.style.width = ''
            dock.style.justifyContent = ''
            dock.style.paddingLeft = ''
            dockRef.current = null
          }
        }
      }, [cwd, hasStatus])

      const open = React.useCallback(async (kind) => {
        if (!cwd) return
        const nextRect = pillRef.current === null ? null : pillRef.current.getBoundingClientRect()
        setRect(nextRect)
        setPanelError(null)
        setPanel({ kind })
        if (kind === 'branch') {
          setBranches(null)
          try { setBranches(await getJson(`/dsh-plugin/git-branches?dir=${encodeURIComponent(cwd)}`)) }
          catch (error) { setPanelError(String(error)) }
        }
        if (kind === 'changes') {
          setChanges(null)
          try { setChanges(await getJson(`/dsh-plugin/git-changes?dir=${encodeURIComponent(cwd)}`)) }
          catch (error) { setPanelError(String(error)) }
        }
      }, [cwd])

      const openDiff = React.useCallback(async (file) => {
        setPanel({ kind: 'diff', path: file.path })
        setDiff(null)
        setPanelError(null)
        try {
          setDiff(await getJson(`/dsh-plugin/git-diff?dir=${encodeURIComponent(cwd)}&path=${encodeURIComponent(file.path)}`))
        } catch (error) { setPanelError(String(error)) }
      }, [cwd])

      const switchTo = React.useCallback(async (branch) => {
        setBusy(true)
        setPanelError(null)
        try {
          const result = await postJson('/dsh-plugin/git-switch', { dir: cwd, branch })
          if (result.ok) {
            setPanel(null)
            load()
          } else {
            setPanelError(result.error || '切换失败')
          }
        } catch (error) {
          setPanelError(String(error))
        } finally {
          setBusy(false)
        }
      }, [cwd, load])

      if (!cwd || data === null || data.ok !== true) return null

      const repo = data.repo
      const isGit = data.git !== false && repo.branch !== null && repo.branch !== undefined
      const counts = data.changes
      const pr = data.pr
      const dirty = counts === null
        ? 0
        : counts.staged + counts.unstaged + counts.untracked + counts.conflicted
      const checks = pr?.checks ?? null
      const env = Array.isArray(repo.env) ? repo.env : []
      const pathLabel = repo.displayPath || repo.root
      const canCreatePr = isGit && !repo.detached && typeof repo.github === 'string' && repo.github !== ''

      const groups = []
      groups.push([
        e('span', { key: 'path', className: 'dshws-path', title: repo.homePath || repo.root }, pathLabel),
      ])

      if (isGit) {
        const branchLabel = repo.detached
          ? (repo.tag ? `⌂ ${repo.tag}` : `⌂ ${repo.shortSha || 'detached'}`)
          : `⎇ ${repo.branch}`
        const branchTitle = repo.detached
          ? `detached HEAD${repo.shortSha ? ` ${repo.shortSha}` : ''}${repo.tag ? ` @ ${repo.tag}` : ''}`
          : `当前分支：${repo.branch}（点击切换）`
        const group = [e('button', { key: 'branch', type: 'button', title: branchTitle, onClick: () => open('branch') }, branchLabel)]
        if (!repo.detached && repo.tag !== null && repo.tag !== undefined) {
          group.push(e('span', { key: 'tag', className: 'dshws-tag', title: `HEAD 指向 tag ${repo.tag}` }, repo.tag))
        }
        groups.push(group)
      }

      if (isGit && dirty > 0) {
        const group = [
          e('button', {
            key: 'changes',
            type: 'button',
            title: `变更 ${dirty} 个文件（点击查看）`,
            onClick: () => open('changes'),
          }, e('span', { style: { display: 'inline-flex', gap: '4px' } },
            counts.staged > 0 ? e('span', { style: { color: GREEN } }, `+${counts.staged}`) : null,
            counts.unstaged > 0 ? e('span', { style: { color: AMBER } }, `~${counts.unstaged}`) : null,
            counts.untracked > 0 ? e('span', { style: { color: MUTED } }, `?${counts.untracked}`) : null,
            counts.conflicted > 0 ? e('span', { style: { color: RED } }, `!${counts.conflicted}`) : null,
          )),
        ]
        if (counts.ahead > 0) group.push(e('span', { key: 'ahead', style: { color: GREEN } }, `↑${counts.ahead}`))
        if (counts.behind > 0) group.push(e('span', { key: 'behind', style: { color: AMBER } }, `↓${counts.behind}`))
        groups.push(group)
      }

      if (env.length > 0) {
        groups.push(env.map((item, index) => e('span', { key: `env-${index}`, className: 'dshws-env', title: item.title }, item.label)))
      }

      if (pr !== null) {
        groups.push([
          e('button', {
            key: 'pr',
            type: 'button',
            title: `${pr.title}\n点击查看 PR 与检查状态`,
            onClick: () => open('pr'),
          },
          e('span', { className: 'dshws-dot', style: { background: checks?.fail > 0 ? RED : checks?.pending > 0 ? AMBER : GREEN } }),
          e('span', { style: { color: stateColor(pr.state), fontWeight: 600 } }, `#${pr.number} ${prStateLabel(pr)}`)),
        ])
      } else if (canCreatePr) {
        const compare = `https://github.com/${repo.github}/compare/${encodeURIComponent(repo.branch)}?expand=1`
        groups.push([
          e('button', {
            key: 'create-pr',
            type: 'button',
            style: { color: MUTED },
            title: '在 GitHub 创建 Pull Request',
            onClick: () => window.open(compare, '_blank', 'noopener'),
          }, '+ PR'),
        ])
      }

      const balanceWallets = balance !== null && balance.status === 'ready' && Array.isArray(balance.value)
        ? balance.value
        : null
      if (balanceWallets !== null) {
        const bonusWallets = Array.isArray(balance.bonusWallets) ? balance.bonusWallets : []
        const primary = balanceWallets[0] ?? bonusWallets[0]
        if (primary !== undefined) {
          groups.push([
            e('button', {
              key: 'balance',
              type: 'button',
              title: balanceTitle(balanceWallets, bonusWallets),
              onClick: () => window.open('https://platform.deepseek.com/usage', '_blank', 'noopener'),
            }, moneyText(primary.balance, primary.currency)),
          ])
        }
      }

      if (data.prError !== null && data.prError !== undefined && pr === null) {
        // Keep the failure observable without a placeholder chip.
        console.warn('[dsh-workspace-status] PR lookup failed:', data.prError)
      }

      const children = []
      groups.forEach((group, index) => {
        if (index > 0) children.push(e('span', { key: `sep-${index}`, className: 'dshws-sep' }, '·'))
        children.push(...group)
      })

      const pill = e('span', {
        ref: pillRef,
        className: 'dshws-pill',
        'data-git-pill': '1',
        style: { order: -1 },
      }, children)


      let panelBody = null
      if (panel !== null) {
        const kind = panel.kind
        let title = ''
        if (kind === 'branch') title = '切换分支'
        else if (kind === 'changes') title = changes !== null && changes.ok === true ? `变更文件 · ${changes.files.length}` : '变更文件'
        else if (kind === 'diff') title = panel.path
        else title = pr !== null ? `PR #${pr.number}` : 'Pull Request'

        if (kind === 'branch') {
          if (branches === null) panelBody = e('div', { className: 'dshws-empty' }, '加载分支…')
          else if (branches.ok !== true) panelBody = e('div', { className: 'dshws-empty' }, branches.error || '无法读取分支')
          else {
            const rows = []
            rows.push(e('div', { key: 'l-head', className: 'dshws-section' }, '本地分支'))
            for (const branch of branches.local) {
              rows.push(e('button', {
                key: `l-${branch.name}`,
                type: 'button',
                className: `dshws-row${branch.current ? ' current' : ''}`,
                onClick: () => branch.current ? setPanel(null) : switchTo(branch.name),
              },
              e('span', { className: 'dshws-branch' }, branch.name),
              branch.current ? e('span', { className: 'dshws-tag' }, '当前') : null,
              e('span', { className: 'dshws-muted' }, branch.relative)))
            }
            const remoteBranches = branches.remote.slice(0, 20)
            if (remoteBranches.length > 0) {
              rows.push(e('div', { key: 'r-head', className: 'dshws-section' }, '远程分支（只读）'))
              for (const branch of remoteBranches) {
                rows.push(e('div', { key: `r-${branch.name}`, className: 'dshws-row static' },
                  e('span', { className: 'dshws-branch' }, branch.name),
                  e('span', { className: 'dshws-muted' }, branch.relative)))
              }
            }
            panelBody = rows
          }
        } else if (kind === 'changes') {
          if (changes === null) panelBody = e('div', { className: 'dshws-empty' }, '加载变更…')
          else if (changes.ok !== true) panelBody = e('div', { className: 'dshws-empty' }, changes.error || '无法读取变更')
          else if (changes.files.length === 0) panelBody = e('div', { className: 'dshws-empty' }, '工作区干净')
          else {
            panelBody = changes.files.map((file) => e('button', {
              key: file.path,
              type: 'button',
              className: 'dshws-row',
              onClick: () => openDiff(file),
            },
            e('span', { className: 'dshws-badge', style: { color: statusColor(file) } }, file.status === '?' ? '?' : file.status),
            e('span', { className: 'dshws-filewrap' },
              e('span', { className: 'dshws-file' }, file.path),
              file.orig !== null ? e('span', { className: 'dshws-muted', style: { marginLeft: 6 } }, `← ${file.orig}`) : null),
            e('span', { className: 'dshws-muted' }, statusLabel(file))))
          }
        } else if (kind === 'diff') {
          if (diff === null) panelBody = e('div', { className: 'dshws-empty' }, '加载 diff…')
          else if (diff.ok !== true) panelBody = e('div', { className: 'dshws-empty' }, diff.error || '无法读取 diff')
          else {
            const lines = String(diff.text || '').split('\n')
            const max = 2000
            const rendered = lines.slice(0, max).map((line, index) => {
              let cls = ''
              if (line.startsWith('@@')) cls = 'hunk'
              else if (line.startsWith('+++') || line.startsWith('---')) cls = 'meta'
              else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file')) cls = 'meta'
              else if (line.startsWith('+')) cls = 'add'
              else if (line.startsWith('-')) cls = 'del'
              return e('div', { key: index, className: cls }, line.length === 0 ? ' ' : line)
            })
            if (lines.length > max) rendered.push(e('div', { key: 'more', className: 'meta' }, `… 已截断（共 ${lines.length} 行）`))
            if (diff.truncated) rendered.push(e('div', { key: 'trunc', className: 'meta' }, '… 文件过大，仅显示开头部分'))
            panelBody = e('pre', { className: 'dshws-diff' }, rendered)
          }
        } else if (kind === 'pr') {
          if (pr !== null) {
            const rows = []
            rows.push(e('a', { key: 'title', className: 'dshws-pr-title', href: pr.url, target: '_blank', rel: 'noreferrer' }, pr.title))
            rows.push(e('div', { key: 'chips', className: 'dshws-chips' },
              e('span', { className: 'dshws-chip', style: { color: stateColor(pr.state) } }, prStateLabel(pr)),
              pr.reviewDecision !== null && pr.reviewDecision !== '' ? e('span', { className: 'dshws-chip' }, `review: ${String(pr.reviewDecision).toLowerCase()}`) : null,
              pr.mergeable !== null ? e('span', { className: 'dshws-chip', style: { color: pr.mergeable === 'CONFLICTING' ? RED : MUTED } }, `mergeable: ${String(pr.mergeable).toLowerCase()}`) : null,
              pr.additions !== null ? e('span', { className: 'dshws-chip', style: { color: GREEN } }, `+${pr.additions}`) : null,
              pr.deletions !== null ? e('span', { className: 'dshws-chip', style: { color: RED } }, `-${pr.deletions}`) : null,
              pr.changedFiles !== null ? e('span', { className: 'dshws-chip' }, `${pr.changedFiles} files`) : null))
            if (checks !== null && checks.total > 0) {
              rows.push(e('div', { key: 'checks-head', className: 'dshws-section' },
                `Checks · ✓${checks.pass} ✗${checks.fail} ●${checks.pending}`))
              for (const item of checks.items) {
                rows.push(e('div', { key: `c-${item.name}-${item.state}`, className: 'dshws-check' },
                  checkDot(item.bucket),
                  item.url !== null
                    ? e('a', { href: item.url, target: '_blank', rel: 'noreferrer' }, item.name)
                    : e('span', { className: 'dshws-file' }, item.name),
                  e('span', { className: 'dshws-check-state' }, item.state.toLowerCase())))
              }
            } else {
              rows.push(e('div', { key: 'no-checks', className: 'dshws-empty' }, '这个 PR 还没有检查项'))
            }
            rows.push(e('div', { key: 'actions', className: 'dshws-actions' },
              e('a', { className: 'dshws-action primary', href: pr.url, target: '_blank', rel: 'noreferrer' }, '在 GitHub 打开 PR')))
            panelBody = rows
          } else if (data.prError !== null) {
            panelBody = [
              e('div', { key: 'err', className: 'dshws-error' }, `PR 查询失败：${data.prError}`),
              e('div', { key: 'hint', className: 'dshws-empty' }, '检查 gh 是否已登录（gh auth status），以及网络能否访问 github.com。'),
            ]
          } else {
            const compare = repo.github !== null && !repo.detached
              ? `https://github.com/${repo.github}/compare/${encodeURIComponent(repo.branch)}?expand=1`
              : null
            panelBody = [
              e('div', { key: 'none', className: 'dshws-empty' }, '当前分支还没有关联的 Pull Request。'),
              compare !== null
                ? e('div', { key: 'create', className: 'dshws-actions' },
                  e('a', { className: 'dshws-action primary', href: compare, target: '_blank', rel: 'noreferrer' }, '在 GitHub 创建 PR'))
                : null,
            ]
          }
        }

        const panelStyle = {
          left: `${Math.min(Math.max(8, rect === null ? window.innerWidth / 2 - 280 : rect.left), window.innerWidth - Math.min(560, window.innerWidth - 16) - 8)}px`,
          width: `${Math.min(560, window.innerWidth - 16)}px`,
          bottom: rect === null ? '120px' : `${Math.max(8, window.innerHeight - rect.top + 8)}px`,
          maxHeight: 'min(62vh, 620px)',
        }

        const panelNode = e('div', { ref: panelRef, className: 'dshws-panel', style: panelStyle },
          e('div', { className: 'dshws-head' },
            kind === 'diff'
              ? e('button', { type: 'button', className: 'dshws-icon', title: '返回变更列表', onClick: () => open('changes') }, '‹')
              : null,
            e('span', { className: 'dshws-title' }, title),
            e('button', { type: 'button', className: 'dshws-icon', title: '关闭', onClick: () => setPanel(null) }, '×')),
          panelError !== null ? e('div', { className: 'dshws-error' }, panelError) : null,
          busy ? e('div', { className: 'dshws-loading' }, '处理中…') : null,
          e('div', { className: 'dshws-body', style: kind === 'diff' ? { maxHeight: '52vh' } : undefined }, panelBody))

        return e(React.Fragment, null, pill, ReactDOM.createPortal(panelNode, document.body))
      }

      return pill
    }

    function accountMetadata() {
      const boot = typeof globalThis === 'undefined' ? undefined : globalThis.__DSH_BOOT__
      const version = boot && boot.release && typeof boot.release.version === 'string'
        ? boot.release.version
        : '0.0.0'
      return {
        version,
        locale: typeof navigator === 'undefined' ? 'en' : (navigator.language || 'en'),
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      }
    }

    function apply(ctx) {
      installStyle()
      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'git-status',
        order: 2,
        inject: () => ({
          loadBalance: async () => {
            try {
              if (!ctx.remote || !ctx.remote.account) return null
              const result = await ctx.remote.account.getBalance(accountMetadata())
              if (result === null || result === undefined || result.ok !== true) return null
              return result.value ?? null
            } catch {
              return null
            }
          },
        }),
      }, WorkspaceStatusPill))
    }

    exports.name = 'dsh-workspace-status'
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
