# Daily News Summary Task

This is a Sentinel scheduled task. It runs every day at 9:00 AM to collect
and summarize AI/tech news.

## How it works
1. The Sentinel scheduler triggers this task at 9:00 AM daily
2. It launches OpenCode in this directory
3. OpenCode loads the `news-digest` skill and follows the prompt
4. Output is saved to `output/daily-YYYY-MM-DD.md`

## Structure
- `task.yaml` — Task schedule and execution config
- `.opencode/skills/news-digest/SKILL.md` — Project-level skill for news summarization
- `output/` — Generated news summaries
