# dsh-workspace-status

An interactive composer-dock pill for [DeepSeek Harness](https://github.com/deepseek-ai) that shows the current workspace's Git state and lets you act on it without leaving the chat.

```
~/Projects/demo · ⎇ main · +2 ~1 ?3 · node 22 · pnpm · #123 open
```

The pill sits in the row **directly under the input box**, as its first item; the plugin left-aligns that row to the dialog's left edge (the row is centered by the core composer CSS), so it reads like a status bar under the conversation input.

## What it shows

Every item is independent: **an item with no value is not rendered** — there are no placeholders, no `clean`, no empty PR chip.

- **Path** — always shown. `~` abbreviation; long paths collapse to the last two directories (`…/Projects/demo`), full path in the tooltip. Works for non-git directories too
- **Branch / tag** — only in a git repository. Current branch; on a detached HEAD it shows the tag or short SHA; an extra tag chip appears when HEAD is tagged
- **Change counts** — only when the working tree is dirty: staged (`+`), unstaged (`~`), untracked (`?`), conflicted (`!`), ahead (`↑`) / behind (`↓`)
- **Project environment** — only for detected markers: `.nvmrc` / `.node-version` / `.tool-versions` / `mise.toml` / `package.json engines` (node), `.python-version` / `pyproject.toml` / `.venv` (python), `go.mod`, `Cargo.toml`, `pom.xml`, `Gemfile`, lockfiles (`pnpm`/`yarn`/`npm`/`bun`), Docker files
- **Pull request** — shown when the branch has a PR (number, state, draft, and an Actions status dot: `green` all pass, `amber` pending, `red` failure) or, on a GitHub branch without one, as `+ PR` which opens the GitHub compare page to create it. Non-GitHub remotes never show a PR item.

## What you can click

| Click | Panel |
|---|---|
| Branch name | Local branch list (current marked); click a branch to run `git switch` |
| Change counts | Changed-file list with status badges; click any file for its unified diff (untracked files render as a new-file diff) |
| PR chip / `PR ?` / `+ PR` | PR summary: title, state, review decision, mergeable state, `+/-` lines, file count, and the full GitHub Actions check list with links; button opens the PR |
| `+ PR` when no PR | Shortcut to GitHub's compare page to create one |

Failures are visible instead of silent: the pill shows `PR ?` with the `gh` error in its tooltip, and the panel explains what to check.

## Requirements

- `git` on `PATH`
- `gh` (GitHub CLI), authenticated, for PR status
- DSH desktop `>= 0.2.0-rc.2` (or a web build with the `conversation.composer.dock` slot)

## Install

```bash
git clone git@github.com:martinx/dsh-workspace-status.git
cd dsh-workspace-status
bash install.sh
```

Then **restart the DeepSeek Harness app** — the host half registers loopback routes, and changing host code needs an app restart (a page refresh alone is not enough).

## Uninstall

```bash
bash uninstall.sh
```

## Architecture

Two halves in one bundle:

| Half | File | Role |
|---|---|---|
| Host | `lib/index.js` | Cordis plugin; registers loopback routes on `ctx.webServer` |
| Client | `lib/client.js` | Cordis browser plugin; registers a `conversation.composer.dock` entry and renders the pill + panels |

### HTTP routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/dsh-plugin/workspace-status?dir=` | repo identity, change counts, PR + checks summary |
| GET | `/dsh-plugin/git-branches?dir=` | local/remote branches, current branch |
| GET | `/dsh-plugin/git-changes?dir=` | changed files with status codes |
| GET | `/dsh-plugin/git-diff?dir=&path=` | unified diff for one file (HEAD vs worktree) |
| POST | `/dsh-plugin/git-switch` `{dir, branch}` | `git switch <branch>` |

The status route caches per directory for 4 seconds; every `git`/`gh` subprocess has a hard timeout (gh: 10s) so a slow call never blocks the UI. The client polls every 15 seconds while visible and on window focus.

### PR lookup

`gh pr list -R <owner>/<repo> --head <branch> --state all --json ...` — the `-R` is required because the host process does not run inside the repository. `statusCheckRollup` is summarized into pass/fail/pending counts plus the individual check names.

## Security

Every route is loopback-only and read-only, except `git-switch`, which only accepts a branch that already exists locally (`refs/heads/<name>`), never runs a shell, and passes arguments as an argv array. The diff route returns file contents of tracked/untracked files inside the repository.

## Known limitations

- GitHub-only PR/Actions support; GitLab and Bitbucket are not wired.
- Branch switching uses `git switch`; it fails (and the panel shows the error) when the working tree would be overwritten.
- `gh pr list --state all --limit 1` shows the most recently updated PR for the branch, not every PR.
- Diffs are capped at 400 KB / 2000 lines, untracked files at 200 KB.
- Poll-based (15s), not pushed.
- Nested repositories and untracked directories show as a single entry and cannot be diffed as a file.

## License

MIT
