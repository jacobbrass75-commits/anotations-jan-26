# gastown.ps1 - ScholarMark Multi-Agent War Room
# Launches Windows Terminal with Claude Code (lead) + 6 Codex agents in split panes
#
# Usage: .\gastown.ps1
# Requires: Windows Terminal, Claude Code CLI, Codex CLI

$base = "C:\Users\Jacob\GitHub"

# Set agent teams env var for Claude Code
$env:CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1"

# Windows Terminal layout:
#   Tab 1: Claude Code (architect) in main repo
#   Tab 2: 3 Codex agents (auth, chat, writing) - vertical splits
#   Tab 3: 3 Codex agents (theme, citations, extension) - vertical splits

wt.exe `
  --title "Gas Town" `
  -d "$base\anotations-jan-26" --title "Claude Lead" cmd /k "set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 && claude" `; `
  new-tab -d "$base\sm-auth" --title "Auth" cmd /k "codex" `; `
    split-pane -V -d "$base\sm-chat" --title "Chat" cmd /k "codex" `; `
    split-pane -V -d "$base\sm-writing" --title "Writing" cmd /k "codex" `; `
  new-tab -d "$base\sm-theme" --title "Theme" cmd /k "codex" `; `
    split-pane -V -d "$base\sm-citation" --title "Citations" cmd /k "codex" `; `
    split-pane -V -d "$base\sm-ext" --title "Extension" cmd /k "codex"

Write-Host "Gas Town is online. 7 panes launched."
Write-Host ""
Write-Host "Tab 1: Claude Code (Architect) - anotations-jan-26/master"
Write-Host "Tab 2: Auth | Chat | Writing"
Write-Host "Tab 3: Theme | Citations | Extension"
Write-Host ""
Write-Host "Paste each TASK-*.md spec into its respective Codex pane."
