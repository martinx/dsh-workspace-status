# dsh-workspace-status

A composer-dock pill for [DeepSeek Harness](https://github.com/deepseek-ai) that shows the current workspace's Git state at a glance:

```
⎇ main · +2 ~1 ?3 · ↑1 ↓2 · #123 open
```

- **Branch** — including a detached-HEAD warning
- **Change counts** — staged (`+`), unstaged (`~`), untracked (`?`), conflicted (`!`)
- **Tracking** — ahead (`↑`) / behind (`↓`) the upstream
- **Pull request** — for `github.com` remotes, the branch's PR (number, state, draft) via `gh`; clicking it opens the PR
- **Non-Git directories** — the pill simply stays hidden

## Requirements

- `git` on `PATH`
- `gh` (GitHub CLI), authenticated, only if you want PR status
- DSH desktop `>= 0.2.0-rc.2` (or a web build with the `conversation.composer.dock` slot)

## Install

```bash
git clone git@github.com:martinx/dsh-workspace-status.git
cd dsh-workspace-status
bash install.sh
```

Then refresh the DSH window (or restart the DeepSeek Harness app). The installer is idempotent and backs up `cordis.patch.yml` first.

## Uninstall

```bash
bash uninstall.sh
```

## Architecture

Two halves in one bundle:

| Half | File | Role |
|---|---|---|
| Host | `lib/index.js` | Cordis plugin; registers a loopback route on `ctx.webServer` |
| Client | `lib/client.js` | Cordis browser plugin; registers a `conversation.composer.dock` entry |

### HTTP route

```
GET /dsh-plugin/workspace-status?dir=<absolute directory>
```

Response:

```json
{
  "ok": true,
  "repo": {
    "root": "/Users/me/project",
    "name": "project",
    "branch": "main",
    "detached": false,
    "remote": { "host": "github.com", "owner": "me", "repo": "project" },
    "github": "me/project"
  },
  "changes": { "branch": "main", "ahead": 1, "behind": 0, "staged": 2, "unstaged": 1, "untracked": 3, "conflicted": 0 },
  "pr": { "number": 123, "state": "OPEN", "isDraft": false, "url": "https://github.com/me/project/pull/123", "title": "..." }
}
```

`pr` is `null` when the branch has no PR, the remote is not GitHub, or `gh` is unavailable. The host caches each directory for 4 seconds, and every subprocess has a hard timeout, so a slow `gh` call never blocks the UI.

### Client polling

The pill reads the session's `cwd` from the `useSessions` framework hook, fetches the route, and refreshes every 15 seconds while the page is visible plus on window focus. Failures and non-Git directories render nothing.

## Security

The route answers on the DSH web server's loopback listener and accepts only absolute paths that exist as directories. It returns read-only Git metadata — never file contents. If your DSH web server is bound to a non-loopback address, expose the route deliberately.

## Known limitations

- GitHub only for PR status; GitLab/Bitbucket are not wired yet.
- `gh pr list` shows the newest PR for the branch (`--state all`), not every PR.
- One pill per workspace; multi-root workspaces show the current session's `cwd` only.
- Poll-based (15s), not pushed — a fresh commit can take up to 15 seconds to appear.

## License

MIT
