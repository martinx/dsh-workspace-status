// Host half: serves one loopback JSON endpoint with git / GitHub status for a
// directory. The browser half polls it and renders a composer-dock pill.
//
//   GET /dsh-plugin/workspace-status?dir=<absolute path>
//
// The route is intentionally read-only: it runs `git status`, `git remote
// get-url`, and (for github.com remotes) `gh pr list`, each with a timeout,
// and caches per-directory responses for a few seconds.
import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { basename } from 'node:path'

export const name = 'dsh-workspace-status'
export const inject = ['webServer']

const ROUTE = '/dsh-plugin/workspace-status'
const CACHE_MS = 4000

/** @type {Map<string, { at: number, value: unknown }>} */
const cache = new Map()

/**
 * Run one command with a hard timeout, never throwing.
 * @param {string} cmd executable
 * @param {string[]} args arguments
 * @param {number} timeout ms
 * @param {string} [cwd] working directory (defaults to the host process cwd)
 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string }>}
 */
function run(cmd, args, timeout, cwd = process.cwd()) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, cwd, maxBuffer: 4 << 20 }, (error, stdout, stderr) => {
      resolve({ ok: error === null, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

/**
 * Parse `git status --porcelain=v1 --branch` output.
 * @param {string} text porcelain output
 * @returns {{ branch: string | null, ahead: number, behind: number, staged: number, unstaged: number, untracked: number, conflicted: number }}
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
 * Parse a git remote URL into a GitHub owner/repo pair.
 * @param {string} url remote URL
 * @returns {{ host: string, owner: string, repo: string } | null}
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
 * Collect git and GitHub status for one directory.
 * @param {string} dir absolute directory
 * @returns {Promise<Record<string, unknown> | null>} null when not a git work tree
 */
async function collect(dir) {
  const top = await run('git', ['-C', dir, 'rev-parse', '--show-toplevel'], 2000)
  if (!top.ok) return null
  const root = top.stdout.trim()

  const status = await run('git', ['-C', root, 'status', '--porcelain=v1', '--branch', '--untracked-files=normal'], 3000)
  const parsed = parseStatus(status.ok ? status.stdout : '')
  const symbolic = await run('git', ['-C', root, 'symbolic-ref', '--short', '-q', 'HEAD'], 1500)
  const detached = !symbolic.ok
  const branch = detached ? '(detached)' : symbolic.stdout.trim()

  let remote = null
  const remoteRes = await run('git', ['-C', root, 'remote', 'get-url', 'origin'], 1500)
  if (remoteRes.ok) remote = parseRemote(remoteRes.stdout)

  let pr = null
  if (remote !== null && remote.host === 'github.com' && !detached) {
    const gh = await run('gh', [
      'pr', 'list', '-R', `${remote.owner}/${remote.repo}`, '--head', branch, '--state', 'all',
      '--json', 'number,state,isDraft,url,title', '--limit', '1',
    ], 8000, root)
    if (gh.ok) {
      try {
        const list = JSON.parse(gh.stdout)
        if (Array.isArray(list) && list.length > 0) pr = list[0]
      } catch {
        // A gh that printed prose still leaves the pill with branch-only data.
      }
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
  }
}

function send(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(text)
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const dir = url.searchParams.get('dir')
        if (dir === null || !dir.startsWith('/')) return send(res, 400, { ok: false, error: 'dir must be absolute' })
        if (!existsSync(dir) || !statSync(dir).isDirectory()) return send(res, 400, { ok: false, error: 'not a directory' })

        const cached = cache.get(dir)
        if (cached !== undefined && Date.now() - cached.at < CACHE_MS) return send(res, 200, cached.value)

        const value = await collect(dir)
        if (value === null) return send(res, 200, { ok: false, error: 'not a git repository' })
        cache.set(dir, { at: Date.now(), value })
        return send(res, 200, value)
      } catch (error) {
        return send(res, 500, { ok: false, error: String(error) })
      }
    },
  }))
}
