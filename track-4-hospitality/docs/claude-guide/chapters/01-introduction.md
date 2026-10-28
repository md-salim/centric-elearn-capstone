# Chapter 1: Introducing Claude

This guide is for developers on the Larchmont Hotels capstone team who want to use Claude well: as a pair programmer in the terminal, as an engine inside the applications we build, and as a teammate that can plan, implement, test and review work under sensible guardrails. This first chapter sets the scene. It explains what Claude is, the different ways you can reach it, how the model family is organised, and how to pick the right model for a job. It finishes with a map of the rest of the guide so that you can jump straight to the part you need.

## What Claude is

Claude is a family of large language models (LLMs) built by Anthropic. A large language model is a neural network trained on a very large body of text and code so that, given some input text, it predicts useful continuations. Modern Claude models go well beyond autocomplete: they follow instructions, reason through multi-step problems, write and review code, read images and PDFs, call tools that you define, and work for long periods on agentic tasks such as "find the cause of this failing test and fix it".

It helps to hold two mental models of Claude at the same time.

- **Claude as a model.** A stateless function: you send a list of messages (plus optional system prompt and tools) and receive a response. It remembers nothing between calls unless you send the history again.
- **Claude as an agent.** A model wrapped in a harness, such as Claude Code, which runs a loop: the model decides on an action (read a file, run a command, edit code), the harness executes it, the result goes back to the model, and the loop continues until the task is done.

Most confusion when learning Claude comes from mixing these up. When Claude Code "remembers" your project conventions, that is the harness loading a `CLAUDE.md` file into the context on each session, not the model learning. When an API call "forgets" the previous question, that is the stateless model behaving exactly as designed.

## About Anthropic

Anthropic is an AI safety and research company. Its stated mission is to ensure that the world safely makes the transition through transformative AI. In practice this shows up in the product in a few ways that matter to developers:

- Models are trained to be helpful, honest and harmless, and will sometimes decline requests. Newer models report this explicitly with a `refusal` stop reason rather than a vague answer (see Chapter 2).
- Agentic products such as Claude Code have a permission system: by default Claude asks before running commands or editing files, and you decide how much autonomy to grant.
- Anthropic publishes documentation, prompting guidance and model behaviour notes. The developer documentation lives at https://platform.claude.com/docs and the Claude Code documentation at https://code.claude.com/docs.

> NOTE: Facts about models, prices and features in this guide are accurate as of October 2026. The Claude platform moves quickly. When something matters, check the live documentation or, for API work, query the Models API, which reports each model's context window and capabilities.

## The ways to use Claude

Claude is available through several surfaces. They share the same underlying models, but they differ in who runs the loop, where tools execute and how you pay.

| Surface | What it is | Typical user | Who runs the loop |
|---|---|---|---|
| Claude apps (claude.ai, desktop, mobile) | Chat interface with projects, file upload and artefacts | Anyone; quick research and drafting | Anthropic |
| Claude API | HTTP API (`POST /v1/messages`) with official SDKs | Developers building products | You |
| Claude Code (CLI) | Agentic coding tool in your terminal | Developers working in a repository | Claude Code on your machine |
| Claude Code in IDEs | VS Code and JetBrains extensions | Developers who prefer an editor panel | Claude Code on your machine |
| Claude Code desktop and web | Desktop app and claude.ai/code in the browser | Developers, including remote or cloud sessions | Claude Code locally or in the cloud |
| Claude Agent SDK | Claude Code's harness as a library (Python, TypeScript) | Teams building their own coding or file agents | Your process |
| Managed Agents | Server-hosted agents with a per-session sandbox | Teams wanting hosted, long-running agents | Anthropic |
| Cloud platforms | Claude on Amazon Bedrock, Google Cloud Vertex AI, Microsoft Foundry | Organisations standardised on a cloud provider | You |

### Claude apps

The consumer and business apps are the easiest entry point. They are excellent for exploring an idea, summarising a document or drafting a specification before you write code. They are not where you automate work, and they do not see your repository unless you upload files.

### The Claude API

The API is the foundation for everything programmatic. Every request goes through a single endpoint, the Messages API. Tools, structured outputs, thinking and caching are all features of that one endpoint rather than separate APIs. Anthropic publishes official SDKs for Python, TypeScript/JavaScript, Java (also used from Kotlin and Scala), Go, Ruby, C# and PHP. A minimal Python call looks like this:

```python
import anthropic

client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY or an `ant auth login` profile

response = client.messages.create(
    model="claude-opus-5-5",
    max_tokens=16000,
    messages=[{"role": "user", "content": "Explain optimistic concurrency in two paragraphs."}],
)

for block in response.content:
    if block.type == "text":
        print(block.text)
```

Part 5 of this guide covers the API in depth.

### Claude Code

Claude Code is Anthropic's agentic coding tool. You start it in a repository with the `claude` command, describe what you want, and it reads files, searches the code, runs commands, edits files and reports back. It is available as a terminal CLI, as extensions for VS Code and JetBrains IDEs, as a desktop app and on the web. This repository is already configured for Claude Code: there is a `CLAUDE.md` briefing at the root of the track, rules under `.claude/rules/`, specialist subagents under `.claude/agents/`, custom commands under `.claude/commands/`, skills under `.claude/skills/` and hooks under `.claude/hooks/`. Parts 2 and 3 walk through each of these.

### The Claude Agent SDK

The Agent SDK packages the Claude Code harness as a library. You call it with a prompt and options, and it drives the full agent loop with built-in tools for reading, writing and editing files, running shell commands, searching, and fetching web pages, plus MCP servers, subagents, hooks and permissions. You host it yourself. It is the right choice when you want a batteries-included coding or file-processing agent inside your own service or pipeline.

> WARNING: Do not confuse the Agent SDK with the "Tool Runner" in the regular Anthropic SDK. The Tool Runner (`client.beta.messages.tool_runner`) only automates the loop for tools you define; it has no built-in file or shell tools. The Agent SDK is a separate package (`claude-agent-sdk` or `@anthropic-ai/claude-agent-sdk`).

### Managed Agents

Managed Agents is a beta API surface where Anthropic runs the agent loop and hosts a sandboxed container for each session. You create a persisted, versioned agent configuration once, then start sessions that reference it. It suits long-running agents, scheduled agents (for example "every night, summarise yesterday's bookings anomalies") and work that should not run on a developer's laptop.

### Cloud platforms

Organisations that buy cloud services through AWS, Google Cloud or Microsoft Azure can use Claude through Amazon Bedrock, Google Cloud Vertex AI or Microsoft Foundry. Each has its own client class in the SDKs and its own way of naming models (Bedrock IDs take an `anthropic.` prefix, for example). Feature availability can lag or differ between platforms, so check the platform availability table in the documentation before relying on a beta feature.

## The model family

Claude models come in tiers. Within each generation, larger tiers are more capable and more expensive; smaller tiers are faster and cheaper.

- **Fable** is Anthropic's most capable widely released tier, for the hardest reasoning and long-horizon agentic work.
- **Opus** is the high-capability workhorse and the recommended default for most demanding work.
- **Sonnet** balances speed and capability, and is popular for everyday coding, agents and enterprise workloads.
- **Haiku** is the fastest and cheapest tier, suited to high-volume classification, extraction and lightweight sub-tasks.

The table below lists current models as of October 2026. Prices are per million tokens on the first-party Claude API.

| Model | Model ID | Context window | Input $ / 1M | Output $ / 1M |
|---|---|---|---|---|
| Claude Fable 5.1 | `claude-fable-5-1` | 1M | 10.00 | 50.00 |
| Claude Fable 5 | `claude-fable-5` | 1M | 10.00 | 50.00 |
| Claude Opus 5.5 | `claude-opus-5-5` | 1M | 4.00 | 20.00 |
| Claude Opus 5 | `claude-opus-5` | 1M | 5.00 | 25.00 |
| Claude Opus 4.8 | `claude-opus-4-8` | 1M | 5.00 | 25.00 |
| Claude Opus 4.7 | `claude-opus-4-7` | 1M | 5.00 | 25.00 |
| Claude Opus 4.6 | `claude-opus-4-6` | 1M | 5.00 | 25.00 |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | 1M | 2.00 | 10.00 |
| Claude Sonnet 5 | `claude-sonnet-5` | 1M | 2.00 | 10.00 |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | 1M | 3.00 | 15.00 |
| Claude Haiku 5.5 | `claude-haiku-5-5` | 1M | 0.10 | 0.50 |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200K | 1.00 | 5.00 |

A few points are worth calling out.

- **Model IDs are exact strings.** Use them exactly as listed. Do not append date suffixes you may have seen in older examples.
- **Haiku 5.5 pricing is tiered.** The prices above apply to prompts up to 100K tokens; longer prompts cost more.
- **Cloud platforms price separately.** Bedrock and Vertex AI set their own prices; Foundry bills at standard API rates through the Microsoft Marketplace.
- **Output costs more than input.** Across every tier, output tokens cost five times as much as input tokens. Long responses and heavy thinking are where costs accumulate.

> NOTE: Claude Opus 5.5 is the default model throughout this guide. It is cheaper than Claude Opus 5 per token, shares its 1M-token context window and 128K-token maximum output, and is the model the team should reach for unless there is a specific reason to choose otherwise.

### Notable behaviours of current models

Current models differ from older ones in ways that will catch you out if you copy examples from old blog posts.

- **Thinking is adaptive.** Instead of setting a fixed "thinking budget", you let the model decide how much to think and steer depth with an `effort` setting. On Claude Opus 5.5 thinking cannot be switched off at all; you lower effort instead.
- **No assistant prefill.** You can no longer start the assistant's reply for it to force a format. Use structured outputs or clear instructions instead.
- **No forced tool choice on the newest models.** On Claude Opus 5.5, Claude Sonnet 5.5 and Claude Fable 5.1, `tool_choice` of `any` or a specific tool is rejected. Use `auto` with a clear instruction, or structured outputs.
- **Refusals are explicit.** If a safety classifier declines a request, the response has `stop_reason: "refusal"`. Always check the stop reason before reading the content.

Chapter 2 explains each of these concepts in detail.

## Choosing a model

Choosing a model is a trade-off between quality, latency and cost. The right answer depends on the workload, not on a general ranking. Use the following as a starting point and then measure.

| Workload | Recommended starting point | Why |
|---|---|---|
| Agentic coding in Claude Code on this repo | Claude Opus 5.5 at high or xhigh effort | Strong at multi-file reasoning and tool use |
| Hardest architecture, debugging or research tasks | Claude Fable 5.1 | Most capable; worth it when correctness dominates |
| Everyday coding assistance, chatbots | Claude Sonnet 5.5 | Fast and capable at a lower price |
| Bulk classification or extraction (for example tagging thousands of guest reviews) | Claude Haiku 5.5 at low effort | Very cheap, fast, good enough for simple tasks |
| Subagents that mostly read and summarise | Claude Haiku 5.5 or Claude Sonnet 5.5 | Cheaper workers under a capable lead |
| Overnight batch jobs | Any model via the Batches API | Asynchronous processing at half the price |

Some practical rules of thumb:

1. Start with the most capable model you can afford on a realistic sample of tasks, and get the quality right first.
2. Before switching to a cheaper model, try the same model at a lower effort level. On the newest models, lower effort often matches older models at high effort, and staying on one model keeps your prompt cache warm.
3. Judge cost per completed task, not cost per request. A cheaper model that needs three retries is not cheaper.
4. Re-evaluate when a new model is released. Prompts and effort settings tuned for one model are not automatically right for the next.

> TIP: In Claude Code you can switch models during a session with the `/model` command, and adjust effort as well. Try a hard refactor on Opus and a simple rename on a faster model and compare the experience.

## A first look at Claude in this repository

To make the rest of the guide concrete, here is how Claude fits into the Larchmont Hotels project.

- The system manages six hotels: hotels, room types, rooms, guests, bookings, rates, staff, an occupancy report and a channel-manager CSV importer.
- The backend is an ASP.NET Core Web API (`backend/Larchmont.Api`) with EF Core on MySQL 8.4, schema changes run through DbUp migration scripts, and tests use xUnit with `WebApplicationFactory`.
- The frontend is Vite, React 19 and strict TypeScript in `frontend/`.
- The track-level `CLAUDE.md` tells Claude the stack, the commands, the layout and the rules, for example "Request flow is Controller -> Service -> Repository -> DbContext. Do not skip layers" and "Never edit an applied migration; add the next `V00N__name.sql`."
- Specialist subagents (`backend`, `frontend`, `test-writer`, `reviewer`, `db-analyst`, `planner`) split work so that each one has a narrow brief and the right tools.
- Hooks enforce guardrails automatically: one blocks dangerous shell commands, another builds the project after every C# edit, and another logs prompts.

By the end of Part 3 you will be able to explain every file in `.claude/` and write your own.

## How to use this guide

The guide is organised in five parts plus appendices. You can read it front to back, but each part also stands alone.

| Part | Chapters | What you will learn |
|---|---|---|
| Part 1: Foundations | 1 to 3 | What Claude is, core concepts (tokens, context, thinking, tools, cost) and how to prompt well |
| Part 2: Claude Code essentials | 4 to 6 | Installing and driving Claude Code, memory and `CLAUDE.md`, settings and permissions |
| Part 3: Extending Claude Code | 7 to 9 | Slash commands and skills, subagents, hooks, using this repo's configuration as the worked example |
| Part 4: Integration and workflows | 10 to 12 | MCP servers, headless and CI usage, the Agent SDK, and end-to-end team workflows |
| Part 5: The Claude API | 13 to 15 | The Messages API, tool use, structured outputs and streaming, caching, batches and cost |
| Appendices | A onwards | Glossary, cheat sheets and further exercises |

Suggested reading paths:

- **New to Claude altogether:** Part 1, then Chapter 4, then try the exercises before going further.
- **Already using Claude Code casually:** skim Part 1, read Chapters 5 and 6 carefully, then Part 3.
- **Building a feature that calls Claude:** Chapter 2, then Part 5.
- **Setting up team automation:** Part 3 and Part 4.

Each chapter ends with exercises and key takeaways. The exercises are designed to be done in this repository, so you learn on real code rather than toy examples.

> WARNING: Treat Claude's output like a capable colleague's pull request: review it. The project rules require running `dotnet test` (and `npm run build` for frontend changes) before saying work is done, and that applies whether the code came from you or from Claude.

## Exercises

> EXERCISE: Open the track-level `CLAUDE.md` and list every rule it gives Claude. For each rule, write one sentence on what could go wrong if Claude did not know it.

> EXERCISE: Using the model table, estimate the cost of a request with 20,000 input tokens and 2,000 output tokens on Claude Opus 5.5, Claude Sonnet 5.5 and Claude Haiku 5.5. Which would you choose for summarising one guest complaint? For reviewing a database migration?

> EXERCISE: Look inside `.claude/agents/`. For each agent file, note its name, its one-line description and the tools it is allowed to use. Why do you think the `reviewer` agent can write a report but is told not to fix code?

> EXERCISE: Start Claude Code in the track folder and ask it: "Summarise this project's architecture and list the commands I need to run it locally." Compare its answer with the README. What did it get from `CLAUDE.md` and what did it discover by reading files?

## Key takeaways

- Claude is a family of models; Claude Code, the Agent SDK and Managed Agents are harnesses that turn a model into an agent.
- The model is stateless. Anything it "knows" about your project arrives in the context each time, usually via `CLAUDE.md`, rules and the files it reads.
- Choose surfaces by who should run the loop and where tools should execute.
- Claude Opus 5.5 is the sensible default; use Fable for the hardest problems, Sonnet for speed, Haiku for volume.
- Tune effort before switching models, and measure cost per completed task.
- Model details change quickly: verify against the live documentation when it matters.
