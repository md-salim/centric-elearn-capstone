# Chapter 11: Automation, CI and the Agent SDK

So far we have used Claude Code interactively: you type, Claude works, you review. The same engine can also run without a person at the keyboard. It can be called from a shell script, run as a step in a CI pipeline, respond to comments on a pull request, or be embedded in your own program through the Claude Agent SDK.

This chapter covers headless mode, scripting patterns, GitHub integration and the Agent SDK, and finishes with a comparison of the different ways to build an agent on Claude. It closes with a worked example: using Claude to diagnose this repository's failing CI run in `docs/ci-failing-run.log`.

## 11.1 Headless mode with `claude -p`

The `-p` (or `--print`) flag runs Claude Code non-interactively. Claude receives the prompt, works through it using its tools, prints the final answer and exits.

```bash
claude -p "Summarise what backend/Larchmont.Api/Services/ReportService.cs does in five bullet points"
```

Everything you have learnt about the interactive tool still applies: `CLAUDE.md` is loaded, settings and permission rules are honoured, hooks fire, and project subagents and skills are available. The difference is that nobody is there to answer a permission prompt, so you must decide in advance which tools Claude may use.

### Useful flags

| Flag | Purpose |
|---|---|
| `-p "prompt"` | Run once, non-interactively, and print the result |
| `--output-format text` | Plain text output (the default) |
| `--output-format json` | One JSON object at the end, including the result, cost and session ID |
| `--output-format stream-json` | Newline-delimited JSON events as the run progresses |
| `--allowedTools "Read,Grep,Glob"` | Tools Claude may use without asking |
| `--disallowedTools "Bash"` | Tools Claude may never use |
| `--max-turns 5` | Cap the number of agentic turns, to bound cost and runaway loops |
| `--permission-mode plan` | Start in a specific permission mode (for example read-only planning) |
| `--append-system-prompt "..."` | Add instructions to the system prompt for this run |
| `--continue` / `--resume <id>` | Continue the most recent session, or a specific one |
| `--model <name>` | Choose the model for this run |

Tool rules accept the same patterns as `settings.json`. For example, `--allowedTools "Bash(dotnet test:*)"` permits `dotnet test` with any arguments but no other Bash commands.

> WARNING: Avoid granting broad permissions in automation just to stop prompts. A headless run with unrestricted Bash and write access, fed untrusted input such as an issue body, is an open door for prompt injection. Grant the narrowest set of tools the job needs, and run automation in a disposable environment.

### JSON output

For scripts, `--output-format json` is usually the right choice because the result is easy to parse:

```bash
claude -p "List the controllers in backend/Larchmont.Api/Controllers" \
  --allowedTools "Read,Glob,Grep" \
  --output-format json > result.json

# Extract just the answer
jq -r '.result' result.json
```

The JSON object also carries metadata such as the session ID, number of turns and cost, which is useful for logging and budget tracking. The exact field set can change between versions, so check the output of your installed version before depending on a particular field.

`stream-json` emits one JSON object per line as events happen (assistant messages, tool calls, tool results and a final result). Use it when you want to show progress or record a full trace of the run.

## 11.2 Scripting and piping

Because headless Claude reads standard input, it fits naturally into Unix pipelines:

```bash
# Explain a failing build log
cat docs/ci-failing-run.log | claude -p "Explain why this CI run failed and propose the smallest fix"

# Review the current diff
git diff main...HEAD | claude -p "Review this diff against docs/review-checklist.md. Report only failures."

# Draft a commit message from staged changes
git diff --cached | claude -p "Write a concise commit message in the imperative mood for this diff"
```

Some patterns that work well:

- **Fan-out over files.** Loop over a list of files and run one narrow headless call per file, for example "add XML documentation comments to the public methods in this file". Small, independent calls are cheaper and easier to review than one huge request.
- **Gatekeeping.** Run a headless check in a pre-push hook or CI job and fail the build if Claude reports a problem. Keep the instruction precise and ask for a machine-readable answer (for example, "reply with PASS or FAIL on the first line").
- **Batch triage.** Feed a list of issues or log entries and ask for a classification per line.

```bash
#!/usr/bin/env bash
# Illustrative: ask Claude to check each changed C# file for layer violations.
set -euo pipefail
for f in $(git diff --name-only main...HEAD -- '*.cs'); do
  verdict=$(claude -p "Does $f call the DbContext directly from a controller? Reply PASS or FAIL then one line of reason." \
    --allowedTools "Read" --max-turns 3)
  echo "$f: $verdict"
done
```

> TIP: Put the stable instructions for repeated jobs into a slash command or skill (Chapter 7) and call that from the script, for example `claude -p "/plan FEATURE-x.md"`. The script stays short and the instructions live in version control next to the code.

## 11.3 GitHub integration

Anthropic publishes an official GitHub Action, `anthropics/claude-code-action`, which runs Claude Code inside GitHub Actions. Once it is installed on a repository, people can mention `@claude` in an issue or pull-request comment to ask for an explanation, a review or an implementation, and Claude replies in the thread or pushes a branch.

The quickest way to set it up is to run `/install-github-app` from inside Claude Code, which walks you through installing the GitHub app and adding the required secret. You can also add a workflow file by hand. A minimal workflow looks broadly like this; check the action's README for the current inputs before relying on any of them:

```yaml
# Illustrative only; consult the claude-code-action README for current inputs.
name: Claude
on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
jobs:
  claude:
    if: contains(github.event.comment.body, '@claude')
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

Things to decide before you turn it on:

- **Who can trigger it.** Restrict triggers to trusted collaborators. Comment bodies are untrusted input.
- **What it can change.** Give the workflow the minimum GitHub permissions. Have Claude open pull requests rather than push to protected branches.
- **What it reads.** The action reads your repository's `CLAUDE.md`, so the project conventions you wrote for interactive use apply in CI too.
- **Cost.** Every run uses API tokens. Set `--max-turns` style limits where the action allows and watch usage.

Claude can also be called from ordinary workflow steps in headless mode, for example to summarise a test failure and post it as a comment. The same rules apply: narrow tools, secrets from the secret store, and no blind trust in input from forks.

## 11.4 Worked example: diagnosing a failing CI run

This repository includes a captured log of a failed run, `docs/ci-failing-run.log`. It is a good exercise in using Claude for CI diagnosis because it fails in two different ways at once.

A prompt that works well:

```text
Read docs/ci-failing-run.log. For each failing job, quote the first real error line,
explain the cause, and point to the file in this repo that must change. Then propose
the smallest change to the CI workflow. Do not edit anything yet.
```

The two errors Claude should find are these. In the backend job:

```text
error NETSDK1045: The current .NET SDK does not support targeting .NET 8.0.
Either target .NET 6.0 or lower, or use a version of the .NET SDK that supports .NET 8.0.
```

The log shows the step `actions/setup-dotnet@v4` with `dotnet-version: 6.0.x`, which installed SDK 6.0.428, while the projects target `net8.0`. The workflow's SDK version does not match the projects. And per this repository's `CLAUDE.md`, the target state is `net10.0`, so the right fix is not "install .NET 8" but "install the SDK that matches the target framework after the M4 bump".

In the frontend job:

```text
##[error]An error occurred trying to start process '/usr/bin/bash' with working directory
'/home/runner/work/larchmont/larchmont/web'. No such file or directory
```

The workflow runs `npm ci` in a folder called `web`, but the React app in this repository lives in `frontend/`. A path in the workflow does not match the repository layout.

Both failures are instances of the same review-checklist item: "The CI workflow runs the same steps and its paths and versions match the repo." Asking Claude to tie the diagnosis back to that checklist item is useful, because it turns a one-off fix into a habit.

> NOTE: Notice the order of operations in the prompt: diagnose first, propose second, edit only after you agree. For CI changes, which you often cannot test locally, that separation saves you from a cycle of push, fail, push again.

## 11.5 The Claude Agent SDK

The **Claude Agent SDK** is the engine behind Claude Code, packaged as a library. It is published as `claude-agent-sdk` for Python and `@anthropic-ai/claude-agent-sdk` for TypeScript. With it, you can build your own agents that have the same capabilities as Claude Code: the agent loop, context management, built-in tools for files, shell and search, MCP support, hooks, subagents and permissions.

You would reach for the Agent SDK when:

- you want a coding or file-system agent embedded in your own application or service;
- headless `claude -p` calls in a script are becoming complex and you want proper code, types and error handling;
- you need programmatic control of permissions, hooks or tool results, rather than configuration files.

### The core idea: `query()`

The central entry point is a `query()` function. You pass a prompt and options, and it returns an asynchronous stream of messages as the agent works: assistant text, tool calls, tool results and a final result message.

The sketch below shows the shape in Python. It is illustrative: option names and message types evolve, so check the SDK documentation for your installed version before using it.

```python
# Illustrative sketch of the Claude Agent SDK in Python.
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions

async def main() -> None:
    options = ClaudeAgentOptions(
        system_prompt="You are a careful reviewer for the Larchmont codebase.",
        allowed_tools=["Read", "Grep", "Glob"],
        max_turns=10,
        cwd="backend",
    )
    async for message in query(
        prompt="Find any controller that uses LarchmontDbContext directly.",
        options=options,
    ):
        print(message)

asyncio.run(main())
```

### What the options control

Conceptually, the options mirror what you already configure in Claude Code:

| Concept | In Claude Code | In the Agent SDK |
|---|---|---|
| Instructions | `CLAUDE.md`, system prompt | A system prompt option, and optionally loading project settings |
| Tool access | `permissions` in `settings.json` | Allowed and disallowed tool lists, permission mode, a permission callback |
| Limits | `--max-turns` | A max-turns option |
| Working directory | Where you start `claude` | A working-directory option |
| External systems | `.mcp.json` | MCP server definitions passed in code, including in-process tools |
| Automation | Hooks in `settings.json` | Hook callbacks registered in code |
| Delegation | `.claude/agents/*.md` | Subagent definitions passed in code |

Hooks in the SDK are functions in your program rather than shell commands, so they can do things like block a tool call based on application state or record every tool use in your own database. Subagents work as in Claude Code: the main agent can delegate a focused task to a subagent that has its own prompt, tools and context window.

> TIP: If you have already built a good set of project subagents, skills and hooks for interactive use, as this repository has under `.claude/`, try running them through the SDK before rewriting them in code. Starting from the configuration you already trust shortens the path to a working automated agent.

## 11.6 Choosing how to build an agent

The Agent SDK is one of several ways to build an agent on Claude. They differ in two questions: who provides the **harness** (the agent loop and context management), and who provides the **deployment** (the infrastructure the agent runs on).

| Approach | You write | Harness | Deployment | Tools available | Best for |
|---|---|---|---|---|---|
| Claude API, manual loop | The `while stop_reason == "tool_use"` loop yourself | You | You | Only tools you define | Full control over every step, no extra dependency |
| Claude API, Tool Runner | Just the tool functions | SDK helper (`client.beta.messages.tool_runner`) | You | Only tools you define | Custom-tool agents without hand-writing the loop |
| Claude Agent SDK | A prompt and options | Claude Code's harness | You | Built-in file, shell, search and web tools, plus MCP and subagents | A batteries-included coding or file-system agent on your own infrastructure |
| Managed Agents | An agent configuration and your tool results | Anthropic | Anthropic hosts a per-session sandbox | Hosted bash, files and code execution, plus Skills, MCP and your tools | Hosted, long-running or scheduled agents, with versioned configurations |

Two pairs are easily confused:

- **Tool Runner is not the Agent SDK.** The Tool Runner is a small helper inside the regular Anthropic API SDK (`anthropic` or `@anthropic-ai/sdk`). It loops over tools you define and has no built-in tools. The Agent SDK is the full Claude Code harness with built-in tools.
- **The Agent SDK is not Managed Agents.** With the Agent SDK you host the process yourself. With Managed Agents, Anthropic runs the loop and hosts the container where tools execute; you create a persisted agent configuration once and start sessions against it.

A reasonable decision path:

1. Does the task need an agent at all? Classification, summarisation and extraction are single API calls. Stay simple when you can.
2. Do you only need your own tools? Use the Tool Runner.
3. Do you need a coding agent with file and shell access on your own machines or CI? Use the Agent SDK (or `claude -p` for simple cases).
4. Do you want Anthropic to host the loop and the sandbox, keep versioned agent configurations, or run on a schedule? Use Managed Agents.

Chapters 13 to 15 cover the Claude API surfaces in detail.

## 11.7 Operating automation safely

Whatever surface you choose, the same operational rules keep automated Claude runs predictable:

- **Least privilege.** Allow only the tools a job needs. Prefer read-only jobs; when writes are necessary, write to a branch and open a pull request.
- **Bounded runs.** Set a maximum number of turns and a timeout on the job. For API-based agents, also watch token budgets.
- **Untrusted input.** Treat issue bodies, comments, web pages and files from forks as hostile. Do not combine untrusted input with write access and network access in the same run.
- **Secrets.** Supply API keys and database passwords through the CI secret store or environment, never in files committed to the repository.
- **Observability.** Keep the JSON or stream-JSON output of every automated run as an artefact, so you can see what Claude did and why.
- **Human review.** Automation drafts; people approve. Keep a person in the loop before anything merges or deploys.

## Exercises

> EXERCISE: Run `claude -p "List every controller and its route prefix" --allowedTools "Read,Glob,Grep" --output-format json` in this repository. Use `jq` to print only the result, then find the session ID and resume that session interactively with `claude --resume`.

> EXERCISE: Pipe `docs/ci-failing-run.log` into a headless Claude call and compare its diagnosis with section 11.4. Did it find both failures? Did it notice that the target framework is moving to `net10.0`?

> EXERCISE: Write a short shell script that runs a headless review of `git diff main...HEAD` against `docs/review-checklist.md` and exits with a non-zero status if the first line of Claude's reply is FAIL. Use `--max-turns` and a read-only tool list.

> EXERCISE: For each of these tasks, choose manual loop, Tool Runner, Agent SDK or Managed Agents, and justify the choice in one sentence: a nightly job that summarises yesterday's bookings; a bot that triages new GitHub issues; an internal tool that refactors C# files on a developer's machine; a classifier for guest feedback.

> EXERCISE: Read the GitHub Actions example in section 11.3 and list three changes you would make before enabling it on a public repository.

## Key takeaways

- `claude -p` runs Claude Code non-interactively, with the same `CLAUDE.md`, settings, hooks, skills and subagents as an interactive session.
- Decide tool access in advance with `--allowedTools` and `--disallowedTools`, and bound runs with `--max-turns`.
- Use `--output-format json` for scripts and `stream-json` for progress and full traces.
- Headless Claude fits naturally into pipelines: explain logs, review diffs, draft messages, gate builds.
- The official GitHub Action lets teammates call `@claude` from issues and pull requests; restrict who can trigger it and what it can change.
- The Claude Agent SDK packages Claude Code's harness as a library, built around `query()`, with options for tools, permissions, MCP, hooks and subagents.
- Choose between a manual loop, the Tool Runner, the Agent SDK and Managed Agents by asking who should own the harness and who should own the deployment.
