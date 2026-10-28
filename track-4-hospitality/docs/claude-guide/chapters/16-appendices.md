# Appendices

These appendices are designed for quick reference. Keep them open while you work, and return to the learning plan in Appendix D to structure your first month.

## Appendix A: Glossary

| Term | Meaning |
|---|---|
| Adaptive thinking | A thinking mode in which Claude decides when and how much to reason before answering; set with `thinking: {"type": "adaptive"}` |
| Agent | A system in which a model chooses and calls tools in a loop to complete a task |
| Agent SDK | Claude Code packaged as a library (Python and TypeScript), with built-in tools, hooks, subagents and permissions |
| Anthropic | The company that builds Claude |
| API key | A secret credential used to authenticate API requests; never commit one |
| Assistant prefill | Ending a request with a partial assistant turn to steer output; rejected on current models |
| Auto mode | A Claude Code permission mode in which most actions proceed without prompting, subject to safety checks |
| Batch | A group of Messages requests processed asynchronously at reduced cost |
| Breakpoint | A `cache_control` marker that ends a cacheable prefix |
| Cache read | Input tokens served from the prompt cache at a much lower price |
| Cache write | Input tokens stored in the prompt cache on first use, at a small premium |
| CLAUDE.md | A Markdown file of project or personal instructions that Claude Code loads into context at the start of a session |
| Claude Code | Anthropic's agentic coding tool, available in the terminal, IDEs, desktop and web |
| Compaction | Summarising earlier conversation to free context space; `/compact` in Claude Code, a beta feature in the API |
| Content block | One element of a message's `content` list, such as `text`, `thinking`, `tool_use` or `tool_result` |
| Context window | The maximum number of tokens a model can consider in one request |
| Context editing | An API feature that clears old tool results or thinking blocks from the request |
| Effort | A setting (`low` to `max`) in `output_config` that trades thoroughness against token spend |
| Evaluation (eval) | A repeatable set of test inputs with a grading method, used to measure prompt or model changes |
| Files API | An endpoint for uploading files once and referencing them by ID |
| Fork | In Claude Code, a subagent that inherits the parent conversation's context |
| Headless mode | Running Claude Code non-interactively with `claude -p`, for scripts and CI |
| Hook | A user-defined command that Claude Code runs at a lifecycle event, such as before or after a tool call |
| Managed Agents | An Anthropic-hosted agent surface where Anthropic runs the loop and a per-session sandbox |
| `max_tokens` | The hard ceiling on output tokens for one response |
| MCP | Model Context Protocol, an open standard for connecting models to tools and data sources |
| MCP server | A process or service exposing tools, resources or prompts over MCP |
| Memory | Information persisted across sessions, such as CLAUDE.md files and Claude Code's memory directory |
| Messages API | The core `POST /v1/messages` endpoint |
| Model ID | The exact string naming a model, for example `claude-opus-5-5` |
| Output config | The `output_config` request object holding `effort` and `format` |
| Permission mode | How Claude Code asks before acting: default, accept edits, plan mode, auto and others |
| Plan mode | A Claude Code mode in which Claude researches and proposes a plan without editing files |
| Prompt caching | Reusing the processed form of an unchanged prompt prefix |
| Prompt injection | Untrusted content that tries to give the model instructions |
| Refusal | A response with `stop_reason: "refusal"`, where a safety classifier declined the request |
| Rules file | A Markdown file of conventions (in this repo, under `.claude/rules/`) referenced from CLAUDE.md |
| Server tool | A tool that runs on Anthropic's infrastructure, such as web search or code execution |
| Session | One Claude Code conversation, which can be resumed later |
| Settings file | JSON configuration for Claude Code (`settings.json`), at user, project or local scope |
| Skill | A packaged set of instructions (a `SKILL.md` and optional files) that Claude loads when relevant or on request |
| Slash command | A command typed with a leading `/` in Claude Code, built in or defined by the project |
| Stop reason | The `stop_reason` field explaining why a response ended |
| Streaming | Receiving a response incrementally as server-sent events |
| Strict tool | A tool with `strict: true`, guaranteeing that inputs validate against its schema |
| Structured outputs | Constraining the response to a JSON Schema via `output_config.format` |
| Subagent | A separate Claude instance with its own context, tools and instructions, launched for a delegated task |
| System prompt | Instructions in the top-level `system` field that apply to the whole conversation |
| Token | The unit models read and write; roughly part of a word |
| Tool | A named capability with a JSON Schema that Claude can ask to call |
| Tool Runner | An SDK helper that runs the tool-use loop for tools you define |
| Tool use | The cycle of `tool_use` requests from Claude and `tool_result` replies from your code |
| Worktree | A separate git working directory; Claude Code can run a task in an isolated worktree |

## Appendix B: Claude Code cheat sheet

### Starting Claude Code

| Command | What it does |
|---|---|
| `claude` | Start an interactive session in the current directory |
| `claude "explain this repo"` | Start a session with an initial prompt |
| `claude -p "query"` | Run once non-interactively and print the result (headless mode) |
| `claude -c` | Continue the most recent conversation in this directory |
| `claude -r` | Resume a previous conversation, chosen from a list |
| `claude --agent planner` | Run the session as a named agent from `.claude/agents/` |
| `claude mcp list` | List configured MCP servers |
| `claude mcp add <name> ...` | Add an MCP server |
| `claude update` | Update Claude Code |

### Useful flags

| Flag | What it does |
|---|---|
| `-p`, `--print` | Print the response and exit |
| `-c`, `--continue` | Continue the most recent conversation |
| `-r`, `--resume` | Resume a specific conversation |
| `--model <name>` | Choose the model for the session |
| `--permission-mode <mode>` | Start in a given permission mode, for example `plan` |
| `--allowedTools` | Tools allowed without prompting |
| `--disallowedTools` | Tools that are blocked |
| `--add-dir <path>` | Give Claude access to an extra directory |
| `--output-format` | `text`, `json` or `stream-json` in headless mode |
| `--max-turns <n>` | Limit agent turns in headless mode |
| `--mcp-config <file>` | Load MCP servers from a file |
| `--verbose` | Show detailed turn-by-turn output |

### Built-in slash commands

| Command | What it does |
|---|---|
| `/help` | Show help and available commands |
| `/init` | Generate a starter CLAUDE.md for the project |
| `/memory` | Open and edit memory and CLAUDE.md files |
| `/clear` | Clear the conversation and start fresh |
| `/compact` | Summarise the conversation to free context, optionally with focus instructions |
| `/context` | Show how the context window is being used |
| `/model` | Change the model |
| `/config` | Open settings |
| `/permissions` | View and edit permission rules |
| `/agents` | Manage subagents |
| `/mcp` | Manage MCP server connections |
| `/hooks` | Review hook configuration |
| `/cost` | Show token usage for the session |
| `/resume` | Resume an earlier conversation |
| `/rewind` | Roll back the conversation and code changes to an earlier point |
| `/doctor` | Check the installation for problems |
| `/login`, `/logout` | Switch accounts |

Project commands in this repository include `/plan`, `/implement`, `/handoff` and `/reflect`, defined in `.claude/commands/`.

### Keyboard shortcuts

| Keys | What they do |
|---|---|
| `Esc` | Interrupt Claude while it is working |
| `Esc` `Esc` | Open the rewind menu to go back to an earlier message |
| `Shift+Tab` | Cycle permission modes (including plan mode) |
| `@` | Mention a file or folder to add it to context |
| `!` | Run a shell command directly (bash mode) |
| `Ctrl+C` | Cancel the current input or generation |
| Up arrow | Recall previous prompts |

### File locations

| Path | Purpose |
|---|---|
| `~/.claude/CLAUDE.md` | Personal instructions for all projects |
| `CLAUDE.md` (repo root or subfolder) | Shared project instructions, committed to git |
| `CLAUDE.local.md` | Personal project instructions, not committed |
| `~/.claude/settings.json` | User settings |
| `.claude/settings.json` | Project settings, committed |
| `.claude/settings.local.json` | Personal project settings, not committed |
| `.claude/agents/*.md` | Project subagents |
| `.claude/commands/*.md` | Project slash commands |
| `.claude/skills/<name>/SKILL.md` | Project skills |
| `.claude/rules/*.md` | Project rule files (this repo's convention) |
| `.claude/hooks/` | Hook scripts (this repo's convention) |
| `.mcp.json` | Project MCP server configuration |

### Hook events

| Event | When it fires |
|---|---|
| `PreToolUse` | Before a tool runs; can block it |
| `PostToolUse` | After a tool succeeds |
| `UserPromptSubmit` | When you submit a prompt |
| `Stop` | When Claude finishes responding |
| `SubagentStop` | When a subagent finishes |
| `SessionStart` | When a session starts or resumes |
| `SessionEnd` | When a session ends |
| `PreCompact` | Before context is compacted |
| `Notification` | When Claude Code sends a notification |

A hook command that exits with code 2 blocks the action and feeds its error output back to Claude. In this repository, `block-dangerous-bash.js` and `build-on-cs-edit.js` are examples.

## Appendix C: Claude API cheat sheet

### Minimal request

```python
import anthropic
client = anthropic.Anthropic()
r = client.messages.create(
    model="claude-opus-5-5",
    max_tokens=16000,
    messages=[{"role": "user", "content": "Hello"}],
)
print("".join(b.text for b in r.content if b.type == "text"))
```

### Request parameters

| Parameter | Purpose |
|---|---|
| `model` | Exact model ID |
| `max_tokens` | Output ceiling |
| `messages` | Conversation history, starting with `user` |
| `system` | System prompt (string or list of blocks) |
| `tools` | Tool definitions |
| `tool_choice` | `auto` (default) or `none`; forced modes rejected on current top models |
| `thinking` | `{"type": "adaptive"}`, optionally with `display` |
| `output_config` | `effort` and `format` (structured outputs) |
| `cache_control` | Automatic prompt caching at the top level |
| `stream` | Low-level streaming flag; prefer the `stream()` helper |

### Response essentials

| Field | Check |
|---|---|
| `stop_reason` | `end_turn`, `max_tokens`, `stop_sequence`, `tool_use`, `pause_turn`, `refusal` |
| `stop_details` | Only populated on `refusal` |
| `content` | Iterate blocks; check `type` |
| `usage.input_tokens` | Uncached input |
| `usage.cache_read_input_tokens` | Cached input read |
| `usage.cache_creation_input_tokens` | Input written to cache |
| `usage.output_tokens` | Output, including thinking |

### Do and do not

| Do | Do not |
|---|---|
| Use `thinking: {"type": "adaptive"}` | Send `budget_tokens` to current models |
| Set `output_config.effort` explicitly | Rely on defaults when migrating |
| Use structured outputs for JSON | Use assistant prefill |
| Return all parallel tool results in one message | Split results across messages |
| Catch typed exceptions, most specific first | Match on error message strings |
| Stream long requests | Set `max_tokens` very high without streaming |
| Keep prompts byte-stable for caching | Put timestamps in the system prompt |
| Match batch results by `custom_id` | Assume batch results are in order |

### Models at a glance

| Model | ID | Input / output per million tokens |
|---|---|---|
| Claude Fable 5.1 | `claude-fable-5-1` | $10 / $50 |
| Claude Opus 5.5 | `claude-opus-5-5` | $4 / $20 |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | $2 / $10 |
| Claude Haiku 5.5 | `claude-haiku-5-5` | $0.10 / $0.50 |

## Appendix D: A 30-day learning plan

The plan assumes about an hour a day alongside normal work. Each week ends with something you can show a colleague.

| Day | Focus | Activity |
|---|---|---|
| 1 | Installation | Install Claude Code, sign in, run `/doctor` |
| 2 | First session | Ask Claude Code to explain the Larchmont repository layout |
| 3 | CLAUDE.md | Read the root and `frontend/` CLAUDE.md files; note what each rule prevents |
| 4 | Context | Use `@` mentions and `/context`; practise `/clear` between tasks |
| 5 | Permissions | Review `.claude/settings.json`; try default, accept-edits and plan modes |
| 6 | Plan mode | Plan a small change in plan mode before any edit |
| 7 | Review | Make one small, tested change end to end and write up what you learned |
| 8 | Prompting | Rewrite three vague prompts into specific ones with goals and constraints |
| 9 | Rules | Read `.claude/rules/`; ask Claude to check a file against the conventions |
| 10 | Slash commands | Read `.claude/commands/plan.md`; run `/plan` on a ticket |
| 11 | Skills | Read a skill in `.claude/skills/`; invoke it and inspect the result |
| 12 | Subagents | Read `.claude/agents/`; delegate one research task to a subagent |
| 13 | Hooks | Read `block-dangerous-bash.js`; explain how it blocks a command |
| 14 | Review | Write a new project slash command for a task you repeat |
| 15 | MCP | Read `docs/mcp-security.md`; list configured servers with `claude mcp list` |
| 16 | MCP practice | Query the database through an MCP server with a read-only user |
| 17 | Headless | Run `claude -p` with `--output-format json` from a script |
| 18 | Testing | Use the test-writer agent to add a failing test first, then fix it |
| 19 | Review | Run the reviewer agent on a diff and act on its report |
| 20 | Git workflow | Have Claude prepare a commit and PR description; review every line |
| 21 | Review | Hold a short demo of your workflow for the team |
| 22 | API basics | Make your first Messages request in Python and in C# |
| 23 | Thinking and effort | Compare `low`, `medium` and `high` effort on the same task |
| 24 | Streaming and errors | Add streaming and a full error-handling chain |
| 25 | Tools | Build a manual tool-use loop with one read-only tool |
| 26 | Tool Runner | Rebuild the same agent with the Tool Runner |
| 27 | Structured outputs | Extract typed data from sample channel-manager rows |
| 28 | Caching | Add prompt caching and prove a cache hit from `usage` |
| 29 | Batches and cost | Run a small batch; estimate cost per completed task |
| 30 | Capstone | Ship a small Claude-powered feature behind a service class, with tests and a review |

## Appendix E: Hints for selected exercises

These are hints, not model answers. The point of each exercise is the reasoning, so try it first.

### Claude Code exercises

- **Writing a CLAUDE.md.** Start with what a new teammate gets wrong in their first week. Each line should prevent a real mistake. If a rule can be checked by a tool (a linter, a test, a hook), prefer the tool and keep the line short.
- **Choosing a permission mode.** Ask what happens if Claude is wrong. Reversible, local edits suit accept-edits mode; anything touching shared state, secrets or production deserves prompts or a hook.
- **Designing a subagent.** A good subagent has a narrow job, the fewest tools that job needs, and a description that says exactly when to use it. If you cannot write a one-sentence brief, the task is not ready to delegate.
- **Writing a hook.** Keep hooks fast and deterministic. Read the JSON input from standard input, decide, and exit with code 2 (with a clear message on standard error) only when you mean to block.
- **Using MCP safely.** Start from the principle of least privilege: a read-only database user, a narrow set of tools, and no secrets in committed configuration.

### API exercises

- **Porting the summariser to C# (Chapter 13).** Register `AnthropicClient` as a singleton, inject it into a service, and read the key from an environment variable or user secrets. Test the controller and service against a mocked interface you own, not the SDK class.
- **Token limit check (Chapter 13).** Count tokens first; if over the limit, return a clear message asking for a shorter text or offering to summarise in parts. Do not silently truncate.
- **Effort comparison (Chapter 13).** Record output tokens and latency for each run, and score quality against a short checklist. Choose the lowest effort that meets the bar.
- **Front-desk tools (Chapter 14).** `extend_booking` changes state, so it needs approval. In the Tool Runner, the function can ask for confirmation and return a "declined" result when the user says no.
- **Recovering from tool errors (Chapter 14).** A good error message names the valid range ("hotel_id must be between 1 and 6"). Better descriptions prevent errors in the first place.
- **CSV extraction (Chapter 14).** Disagreements usually come from ambiguous dates, currencies or room-type codes. The importer's validators should be the source of truth; use the model's output to find gaps in them.
- **Proving a cache hit (Chapter 15).** Send two identical requests within five minutes. The first should show `cache_creation_input_tokens` above zero; the second should show `cache_read_input_tokens` above zero. If not, look for anything that changes between requests.
- **Nightly batch (Chapter 15).** Store the batch ID, poll on a schedule, write results keyed by `custom_id`, and re-queue `errored` or `expired` items with a retry limit.
- **Privacy review (Chapter 15).** The summariser needs the feedback text and perhaps the hotel; it does not need names, emails, phone numbers or booking references. Strip them before sending.

## Appendix F: Further reading

Official sources change faster than any printed guide. When this document and the official documentation disagree, trust the documentation.

| Resource | Address |
|---|---|
| Claude Code documentation | https://code.claude.com/docs |
| Claude Agent SDK documentation | https://code.claude.com/docs/en/agent-sdk |
| Claude Developer Platform documentation | https://platform.claude.com/docs |
| Claude API getting started | https://platform.claude.com/docs/en/get-started |
| Anthropic documentation home | https://docs.claude.com |
| Model Context Protocol | https://modelcontextprotocol.io |
| Python SDK | https://github.com/anthropics/anthropic-sdk-python |
| TypeScript SDK | https://github.com/anthropics/anthropic-sdk-typescript |
| Anthropic Console | https://platform.claude.com |

### Inside this repository

| File | Why read it |
|---|---|
| `CLAUDE.md` | Project briefing and rules for Claude Code |
| `frontend/CLAUDE.md` | Frontend-specific instructions |
| `.claude/rules/coding-conventions.md` | Back-end coding conventions |
| `.claude/rules/testing-conventions.md` | Test naming and structure |
| `.claude/agents/` | The team's subagents: backend, frontend, test-writer, reviewer, db-analyst, planner |
| `.claude/commands/` | Project slash commands |
| `.claude/hooks/` | Example hooks |
| `docs/agent-map.md` | How the agents fit together |
| `docs/mcp-security.md` | MCP security notes |
| `docs/review-checklist.md` | What the reviewer checks |
| `docs/privacy-note.md` | Rules for handling guest data |
