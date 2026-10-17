// Host half: loopback JSON endpoints for git / GitHub workspace state.
//
//   GET  /dsh-plugin/workspace-status?dir=<abs>
//   GET  /dsh-plugin/git-branches?dir=<abs>
//   GET  /dsh-plugin/git-changes?dir=<abs>
//   GET  /dsh-plugin/git-diff?dir=<abs>&path=<repo-relative>
//   POST /dsh-plugin/git-switch   { dir, branch }
//
// Everything is read-only except the explicit switch endpoint. Each git/gh
// subprocess has a hard timeout and the status route caches for a few seconds.
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

export const name = 'dsh-workspace-status'
export const inject = ['webServer']

const ROUTE_STATUS = '/dsh-plugin/workspace-status'
const ROUTE_BRANCHES = '/dsh-plugin/git-branches'
const ROUTE_CHANGES = '/dsh-plugin/git-changes'
const ROUTE_DIFF = '/dsh-plugin/git-diff'
const ROUTE_SWITCH = '/dsh-plugin/git-switch'

const STATUS_CACHE_MS = 4000
const MAX_DIFF_BYTES = 400 * 1024
const MAX_UNTRACKED_BYTES = 200 * 1024
const MAX_CHECKS = 30

/** @type {Map<string, { at: number, value: unknown }>} */
const statusCache = new Map()

/**
 * Run one command with a hard timeout, never throwing.
 * @param {string} cmd executable
 * @param {string[]} args arguments
 * @param {number} timeout ms
 * @param {string} [cwd] working directory
 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string }>}
 */
function run(cmd, args, timeout, cwd = process.cwd()) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, cwd, maxBuffer: 8 << 20 }, (error, stdout, stderr) => {
      resolve({ ok: error === null, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

/**
 * Parse `git status --porcelain=v1 --branch` output for branch and counts.
 * @param {string} text porcelain output
 */
function parseStatus(text) {
  let branch = null
  let ahead = 0
  let behind = 0
  let staged = 0
  let unstaged = 0
  let untracked = 0
  let conflicted = 0
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      const head = line.slice(3)
      const raw = head.split('...')[0]
      branch = raw === 'No commits yet' ? null : raw
      const aheadMatch = /ahead (\d+)/.exec(head)
      const behindMatch = /behind (\d+)/.exec(head)
      if (aheadMatch !== null) ahead = Number(aheadMatch[1])
      if (behindMatch !== null) behind = Number(behindMatch[1])
      continue
    }
    if (line.length < 2) continue
    const x = line[0]
    const y = line[1]
    if (x === '?' && y === '?') { untracked += 1; continue }
    if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) { conflicted += 1; continue }
    if (x !== ' ' && x !== '?') staged += 1
    if (y !== ' ' && y !== '?') unstaged += 1
  }
  return { branch, ahead, behind, staged, unstaged, untracked, conflicted }
}

/**
 * Parse a git remote URL into host/owner/repo.
 * @param {string} url remote URL
 */
function parseRemote(url) {
  const trimmed = url.trim()
  const ssh = /^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/.exec(trimmed)
  if (ssh !== null) return { host: ssh[1], owner: ssh[2], repo: ssh[3] }
  const https = /^https?:\/\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/.exec(trimmed)
  if (https !== null) return { host: https[1], owner: https[2], repo: https[3] }
  return null
}

/**
 * Parse `git status --porcelain=v1 -z` into changed-file rows.
 * @param {string} text NUL-separated porcelain output
 */
function parseFiles(text) {
  const tokens = text.split('\0')
  const files = []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token.length < 4) continue
    if (token.startsWith('##')) continue
    const x = token[0]
    const y = token[1]
    let path = token.slice(3)
    let orig = null
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      i += 1
      orig = tokens[i] ?? null
      if (orig !== null && path.includes(' -> ')) path = path.split(' -> ').pop()
    }
    const untracked = x === '?' && y === '?'
    const conflicted = x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')
    files.push({
      path,
      orig,
      status: untracked ? '?' : `${x}${y}`.trim() || 'M',
      index: x,
      worktree: y,
      staged: !untracked && !conflicted && x !== ' ' && x !== '?',
      unstaged: !untracked && !conflicted && y !== ' ' && y !== '?',
      untracked,
      conflicted,
    })
  }
  return files
}

/**
 * Summarize `statusCheckRollup` into counts and rows.
 * @param {Array<Record<string, unknown>> | null | undefined} rollup gh checks
 */
function summarizeChecks(rollup) {
  if (!Array.isArray(rollup)) return { total: 0, pass: 0, fail: 0, pending: 0, items: [] }
  let pass = 0
  let fail = 0
  let pending = 0
  const items = []
  for (const entry of rollup.slice(0, MAX_CHECKS)) {
    const conclusion = String(entry.conclusion ?? entry.state ?? '').toUpperCase()
    const status = String(entry.status ?? '').toUpperCase()
    const name = String(entry.name ?? entry.context ?? entry.workflowName ?? 'check')
    let bucket = 'pending'
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusion) || ['SUCCESS', 'EXPECTED'].includes(status)) {
      bucket = 'pass'
      pass += 1
    } else if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(conclusion)
      || ['FAILURE', 'ERROR'].includes(status)) {
      bucket = 'fail'
      fail += 1
    } else {
      pending += 1
    }
    items.push({
      name,
      bucket,
      state: conclusion || status || 'PENDING',
      url: typeof entry.detailsUrl === 'string' ? entry.detailsUrl : null,
    })
  }
  return { total: rollup.length, pass, fail, pending, items }
}

/**
 * Git repository root for a directory, or null.
 * @param {string} dir absolute directory
 */
async function repoRoot(dir) {
  const top = await run('git', ['-C', dir, 'rev-parse', '--show-toplevel'], 2000)
  return top.ok ? top.stdout.trim() : null
}

/**
 * Full workspace status: repository identity, change counts, PR summary.
 * @param {string} dir absolute directory
 */
async function collectStatus(dir) {
  const root = await repoRoot(dir)
  if (root === null) return null

  const status = await run('git', ['-C', root, 'status', '--porcelain=v1', '--branch', '--untracked-files=normal'], 3000)
  const parsed = parseStatus(status.ok ? status.stdout : '')
  const symbolic = await run('git', ['-C', root, 'symbolic-ref', '--short', '-q', 'HEAD'], 1500)
  const detached = !symbolic.ok
  const branch = detached ? '(detached)' : symbolic.stdout.trim()

  let remote = null
  const remoteRes = await run('git', ['-C', root, 'remote', 'get-url', 'origin'], 1500)
  if (remoteRes.ok) remote = parseRemote(remoteRes.stdout)

  let pr = null
  let prError = null
  if (remote !== null && remote.host === 'github.com' && !detached) {
    const gh = await run('gh', [
      'pr', 'list', '-R', `${remote.owner}/${remote.repo}`, '--head', branch, '--state', 'all',
      '--json', 'number,state,isDraft,url,title,reviewDecision,mergeable,additions,deletions,changedFiles,statusCheckRollup',
      '--limit', '1',
    ], 10000, root)
    if (gh.ok) {
      try {
        const list = JSON.parse(gh.stdout)
        if (Array.isArray(list) && list.length > 0) {
          const raw = list[0]
          pr = {
            number: raw.number,
            state: raw.state,
            isDraft: raw.isDraft === true,
            url: raw.url,
            title: raw.title,
            reviewDecision: raw.reviewDecision ?? null,
            mergeable: raw.mergeable ?? null,
            additions: raw.additions ?? null,
            deletions: raw.deletions ?? null,
            changedFiles: raw.changedFiles ?? null,
            checks: summarizeChecks(raw.statusCheckRollup),
          }
        }
      } catch (error) {
        prError = `gh returned unreadable JSON: ${String(error)}`
      }
    } else {
      prError = gh.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 300) || 'gh pr list failed'
    }
  }

  return {
    ok: true,
    repo: {
      root,
      name: basename(root),
      branch,
      detached,
      remote,
      github: remote?.host === 'github.com' ? `${remote.owner}/${remote.repo}` : null,
    },
    changes: parsed,
    pr,
    prError,
  }
}

/**
 * Local and remote branches of a repository.
 * @param {string} dir absolute directory
 */
async function listBranches(dir) {
  const root = await repoRoot(dir)
  if (root === null) return null
  const local = await run('git', [
    '-C', root, 'for-each-ref', '--sort=-committerdate',
    '--format=%(refname:short)|%(committerdate:relative)|%(HEAD)',
    'refs/heads',
  ], 3000)
  const remote = await run('git', [
    '-C', root, 'for-each-ref', '--sort=-committerdate',
    '--format=%(refname:short)|%(committerdate:relative)',
    'refs/remotes',
  ], 3000)
  const rows = (text) => text.trim() === '' ? [] : text.trim().split('\n').map((line) => {
    const [name, relative = '', head = ''] = line.split('|')
    return { name, relative, current: head.trim() === '*' }
  })
  const current = await run('git', ['-C', root, 'symbolic-ref', '--short', '-q', 'HEAD'], 1500)
  return {
    ok: true,
    current: current.ok ? current.stdout.trim() : null,
    local: rows(local.ok ? local.stdout : ''),
    remote: rows(remote.ok ? remote.stdout : '').filter((row) => !row.name.endsWith('/HEAD')),
  }
}

/**
 * Changed files with status codes.
 * @param {string} dir absolute directory
 */
async function listChanges(dir) {
  const root = await repoRoot(dir)
  if (root === null) return null
  const st = await run('git', ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=normal'], 4000)
  return { ok: true, root, files: parseFiles(st.ok ? st.stdout : '') }
}

/**
 * Unified diff for one changed file (HEAD vs working tree), or a synthetic
 * new-file diff for untracked files.
 * @param {string} dir absolute directory
 * @param {string} path repo-relative path
 */
async function diffFor(dir, path) {
  const root = await repoRoot(dir)
  if (root === null) return null
  if (typeof path !== 'string' || path === '' || path.includes('\0')) {
    return { ok: false, error: 'invalid path' }
  }
  const absolute = join(root, path)
  if (!existsSync(absolute)) {
    const del = await run('git', ['-C', root, 'diff', '--no-color', '-U3', 'HEAD', '--', path], 6000)
    return { ok: true, path, text: del.stdout, truncated: false }
  }
  const tracked = await run('git', ['-C', root, 'ls-files', '--error-unmatch', '--', path], 2000)
  if (!tracked.ok) {
    const info = statSync(absolute)
    if (!info.isFile()) return { ok: false, error: '目录或子仓库，无法显示单文件 diff' }
    const buffer = readFileSync(absolute).subarray(0, MAX_UNTRACKED_BYTES)
    const text = buffer.toString('utf8')
    const lines = text.split('\n')
    const body = lines.map((line) => `+${line}`).join('\n')
    return {
      ok: true,
      path,
      untracked: true,
      text: [
        `diff --git a/${path} b/${path}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${path}`,
        `@@ -0,0 +1,${lines.length} @@`,
        body,
      ].join('\n'),
      truncated: buffer.length >= MAX_UNTRACKED_BYTES,
    }
  }
  const diff = await run('git', ['-C', root, 'diff', '--no-color', '-U3', 'HEAD', '--', path], 8000)
  const truncated = diff.stdout.length > MAX_DIFF_BYTES
  return { ok: true, path, text: truncated ? diff.stdout.slice(0, MAX_DIFF_BYTES) : diff.stdout, truncated }
}

/**
 * Switch the repository to an existing local branch.
 * @param {string} dir absolute directory
 * @param {string} branch local branch name
 */
async function switchBranch(dir, branch) {
  const root = await repoRoot(dir)
  if (root === null) return { ok: false, error: 'not a git repository' }
  if (typeof branch !== 'string' || branch === '' || branch.startsWith('-') || branch.includes('\0')) {
    return { ok: false, error: 'invalid branch' }
  }
  const exists = await run('git', ['-C', root, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`], 2000)
  if (!exists.ok) return { ok: false, error: `branch not found: ${branch}` }
  const switched = await run('git', ['-C', root, 'switch', branch], 15000)
  if (!switched.ok) {
    return { ok: false, error: (switched.stderr || switched.stdout).trim().slice(0, 400) || 'git switch failed' }
  }
  return { ok: true, branch }
}

function send(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1 << 20) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function validDir(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return null
  if (!existsSync(value)) return null
  try {
    if (!statSync(value).isDirectory()) return null
  } catch {
    return null
  }
  return value
}

function query(req) {
  return new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
}

export function apply(ctx) {
  const disposers = [
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_STATUS,
      handler: async (req, res) => {
        try {
          const dir = validDir(query(req).get('dir'))
          if (dir === null) return send(res, 400, { ok: false, error: 'invalid dir' })
          const cached = statusCache.get(dir)
          if (cached !== undefined && Date.now() - cached.at < STATUS_CACHE_MS) return send(res, 200, cached.value)
          const value = await collectStatus(dir)
          if (value === null) return send(res, 200, { ok: false, error: 'not a git repository' })
          statusCache.set(dir, { at: Date.now(), value })
          return send(res, 200, value)
        } catch (error) {
          return send(res, 500, { ok: false, error: String(error) })
        }
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_BRANCHES,
      handler: async (req, res) => {
        try {
          const dir = validDir(query(req).get('dir'))
          if (dir === null) return send(res, 400, { ok: false, error: 'invalid dir' })
          const value = await listBranches(dir)
          return send(res, 200, value ?? { ok: false, error: 'not a git repository' })
        } catch (error) {
          return send(res, 500, { ok: false, error: String(error) })
        }
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_CHANGES,
      handler: async (req, res) => {
        try {
          const dir = validDir(query(req).get('dir'))
          if (dir === null) return send(res, 400, { ok: false, error: 'invalid dir' })
          const value = await listChanges(dir)
          return send(res, 200, value ?? { ok: false, error: 'not a git repository' })
        } catch (error) {
          return send(res, 500, { ok: false, error: String(error) })
        }
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_DIFF,
      handler: async (req, res) => {
        try {
          const params = query(req)
          const dir = validDir(params.get('dir'))
          const path = params.get('path')
          if (dir === null) return send(res, 400, { ok: false, error: 'invalid dir' })
          const value = await diffFor(dir, path ?? '')
          return send(res, 200, value ?? { ok: false, error: 'not a git repository' })
        } catch (error) {
          return send(res, 500, { ok: false, error: String(error) })
        }
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_SWITCH,
      handler: async (req, res) => {
        try {
          if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST only' })
          const body = JSON.parse((await readBody(req)) || '{}')
          const dir = validDir(body.dir)
          if (dir === null) return send(res, 400, { ok: false, error: 'invalid dir' })
          statusCache.delete(dir)
          const value = await switchBranch(dir, body.branch)
          return send(res, 200, value)
        } catch (error) {
          return send(res, 500, { ok: false, error: String(error) })
        }
      },
    }),
  ]
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })
}

// Exported for local verification scripts; the Cordis loader ignores extras.
export const testables = { collectStatus, listBranches, listChanges, diffFor, switchBranch }
