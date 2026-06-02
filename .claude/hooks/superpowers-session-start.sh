#!/usr/bin/env bash
# SessionStart hook for vendored Superpowers skills.
#
# Injects the "using-superpowers" skill content into the session context so the
# agent knows it has Superpowers and uses the Skill tool proactively. Adapted
# from obra/superpowers hooks/session-start to read skills from the repo's
# .claude/skills directory instead of a plugin root.

set -euo pipefail

# Project root: provided by Claude Code, with a sensible fallback.
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
SKILL_FILE="${PROJECT_DIR}/.claude/skills/using-superpowers/SKILL.md"

# Read using-superpowers content
using_superpowers_content=$(cat "${SKILL_FILE}" 2>&1 || echo "Error reading using-superpowers skill")

# Escape string for JSON embedding using bash parameter substitution.
escape_for_json() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

using_superpowers_escaped=$(escape_for_json "$using_superpowers_content")
session_context="<EXTREMELY_IMPORTANT>\nYou have superpowers.\n\n**Below is the full content of your 'using-superpowers' skill - your introduction to using skills. For all other skills, use the 'Skill' tool:**\n\n${using_superpowers_escaped}\n</EXTREMELY_IMPORTANT>"

# Emit context injection in Claude Code's expected format.
printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$session_context"

exit 0
