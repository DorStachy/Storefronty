# Vendored Superpowers skills

This directory contains the [Superpowers](https://github.com/obra/superpowers)
skills library by Jesse Vincent (v5.1.0, MIT — see `LICENSE`), vendored into the
repo so it persists across Claude Code on the web sessions (the execution
container is ephemeral and re-cloned each session, so a user-level install under
`~/.claude/skills` would not survive).

## What's here

- `*/SKILL.md` — the individual skills (TDD, systematic debugging, brainstorming,
  writing/executing plans, code review, git worktrees, etc.). They are discovered
  automatically and invoked via the `Skill` tool.
- `../hooks/superpowers-session-start.sh` — a `SessionStart` hook (wired up in
  `../settings.json`) that injects the `using-superpowers` skill so the agent
  knows to reach for these skills proactively.

## Updating

Re-vendor from upstream:

```bash
git clone --depth 1 https://github.com/obra/superpowers.git /tmp/superpowers
rm -rf .claude/skills/*/ && cp -r /tmp/superpowers/skills/* .claude/skills/
```
