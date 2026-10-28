# Chapter 15: Production Concerns

Getting a prototype working takes an afternoon. Running it reliably, cheaply and safely for six hotels is a different job. This chapter covers the features and habits that matter once real traffic arrives: prompt caching, batch processing, the Files API, long-conversation management, cost optimisation, model migration, Managed Agents and data handling.

## 15.1 Prompt caching

Most production prompts repeat a large, stable prefix — a long system prompt, tool definitions, policy documents, few-shot examples — followed by a small variable part. Prompt caching lets the API reuse the processed prefix instead of recomputing it. Cached reads cost roughly a tenth of normal input tokens, and latency drops too.

### The one rule

**Caching is a prefix match.** The cache key is derived from the exact bytes of the prompt up to a breakpoint. Any change anywhere in the prefix — a timestamp, a reordered JSON key, one extra tool — invalidates everything after it.

The rendering order is `tools`, then `system`, then `messages`. So a breakpoint on the last system block caches the tools and the system prompt together.

### Automatic caching

The simplest option is top-level `cache_control`, which caches up to the last cacheable block:

```python
response = client.messages.create(
    model="claude-opus-5-5",
    max_tokens=16000,
    cache_control={"type": "ephemeral"},
    system=LARCHMONT_POLICY_HANDBOOK,     # large and stable
    messages=[{"role": "user", "content": question}],
)
```

### Explicit breakpoints

For finer control, put `cache_control` on specific blocks. You may use up to four breakpoints per request.

```python
response = client.messages.create(
    model="claude-opus-5-5",
    max_tokens=16000,
    tools=TOOLS,                          # fixed list in a fixed order
    system=[{
        "type": "text",
        "text": LARCHMONT_POLICY_HANDBOOK,
        "cache_control": {"type": "ephemeral"},     # default lifetime: 5 minutes
    }],
    messages=history,
)
```

A one-hour lifetime is available with `{"type": "ephemeral", "ttl": "1h"}`; it costs more to write, so use it only when requests on the same prefix are spaced more than a few minutes apart.

### Placement patterns

| Pattern | Where the breakpoint goes |
|---|---|
| Large shared system prompt | On the last system block |
| Multi-turn chat | On the last block of the most recent turn, so each request reuses the whole prior conversation |
| Shared context, varying question | At the end of the shared part, before the question |

### Silent invalidators

These are the usual reasons a cache never hits:

| Cause | Fix |
|---|---|
| Current date or time in the system prompt | Move it to the end of the last user message, or drop it |
| Request IDs or UUIDs early in the prompt | Move them after the last breakpoint |
| `json.dumps()` of a dict with unstable key order | Serialise with sorted keys |
| Tools added or removed per request | Keep a fixed tool list in a fixed order |
| Switching model or effort mid-conversation | Caches are model-scoped; keep them stable within a conversation |
| Prefix below the model's minimum cacheable length | Short prefixes silently do not cache; this is expected |

### Verifying that caching works

Never assume. Check `usage` on consecutive requests:

```python
u = response.usage
print("written to cache:", u.cache_creation_input_tokens)
print("read from cache: ", u.cache_read_input_tokens)
print("uncached input:  ", u.input_tokens)
```

The first request should show a cache write; the second, identical-prefix request within the lifetime should show a cache read. If `cache_read_input_tokens` stays at zero, one of the invalidators above is at work.

> TIP: Log the three usage figures for every request in production. A sudden drop in cache reads is often the first sign that someone has put a timestamp in a prompt.

## 15.2 Message Batches

If you do not need an answer immediately — nightly summaries of guest reviews, re-classifying a month of channel-manager errors — the Batches API processes requests asynchronously at about half the normal price.

```python
from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request

batch = client.messages.batches.create(
    requests=[
        Request(
            custom_id=f"review-{review.id}",
            params=MessageCreateParamsNonStreaming(
                model="claude-opus-5-5",
                max_tokens=2000,
                system=SUMMARY_SYSTEM,
                messages=[{"role": "user", "content": review.text}],
            ),
        )
        for review in reviews
    ]
)

# Later: poll until processing has ended
status = client.messages.batches.retrieve(batch.id)
if status.processing_status == "ended":
    for result in client.messages.batches.results(batch.id):
        if result.result.type == "succeeded":
            save_summary(result.custom_id, result.result.message.content)
        else:
            log.warning("%s: %s", result.custom_id, result.result.type)
```

> WARNING: Batch results arrive in any order. Always match them by `custom_id`, never by position.

Each result has a type of `succeeded`, `errored`, `canceled` or `expired`. Plan for the last three: re-submit or alert, depending on the job.

## 15.3 The Files API

The Files API lets you upload a document once and reference it by ID in many requests, instead of re-sending its bytes each time. It is no longer in beta, so no beta header is needed.

```python
uploaded = client.files.upload(file=open("larchmont-brand-guidelines.pdf", "rb"))

response = client.messages.create(
    model="claude-opus-5-5",
    max_tokens=16000,
    messages=[{
        "role": "user",
        "content": [
            {"type": "document", "source": {"type": "file", "file_id": uploaded.id}},
            {"type": "text", "text": "Check this welcome email against the brand guidelines."},
        ],
    }],
)
```

The content block type must match the file: `document` for PDFs and text, `image` for images. For one-off PDFs you can also send base64 data directly in a `document` block, placed before the text.

## 15.4 Long conversations: compaction and context editing

Even with a one-million-token context window, long-running agents eventually fill up. Two features help, and they are different:

| Feature | What it does | Use it when |
|---|---|---|
| Compaction (beta) | The server summarises earlier context when it approaches a threshold, returning a `compaction` block | Long chats or agent sessions where the gist of old turns still matters |
| Context editing (beta) | Clears old tool results or thinking blocks before the model sees them | Tool-heavy agents whose old results are no longer needed |

With compaction, you **must** append the full `response.content` (not just the text) to your history on each turn. The compaction block is what replaces the summarised history on the next request; dropping it silently loses the state.

```python
response = client.beta.messages.create(
    betas=["compact-2026-01-12"],
    model="claude-opus-5-5",
    max_tokens=16000,
    messages=messages,
    context_management={"edits": [{"type": "compact_20260112"}]},
)
messages.append({"role": "assistant", "content": response.content})
```

> NOTE: This is the API equivalent of `/compact` in Claude Code (Chapter 10). The same trade-off applies: a summary is smaller but loses detail.

## 15.5 Cost optimisation

Cost is driven by tokens in and tokens out, multiplied by the model's price. Judge cost per **completed task**, not per request: a cheaper request that needs two retries is not cheaper.

### Current list prices

| Model | Input per million tokens | Output per million tokens |
|---|---|---|
| Claude Fable 5.1 | $10.00 | $50.00 |
| Claude Opus 5.5 | $4.00 | $20.00 |
| Claude Sonnet 5.5 | $2.00 | $10.00 |
| Claude Haiku 5.5 | $0.10 | $0.50 |

Prices change; always confirm against the official pricing page before making a business case.

### Lever order

Work through the levers in this order. The first group is free; the second trades something away.

1. **Prompt caching.** Usually the biggest single saving for repeated prefixes.
2. **Input hygiene.** Remove unused tools, duplicated instructions and oversized tool results.
3. **Loop hygiene.** Stop agents re-reading the same data; cap iterations.
4. **Output hygiene.** Ask for the length and format you actually need.
5. **Batches.** Move non-urgent work to the Batches API for roughly half price.
6. **Effort.** Lower effort for routes that do not need deep reasoning — chat and classification often do well at `low`.
7. **Model choice.** Only then consider a smaller model, and measure quality on real examples first.

> TIP: Before building a cascade of different models, try the strongest model at lower effort. It often matches or beats an older model at high effort, and a single model keeps a single cache.

> WARNING: Every evaluation run against the real API costs real money. Agree a budget before running large experiments.

## 15.6 Migrating between models

New models arrive frequently, and each generation has changed some request shapes. Before switching a production route:

- Read the migration notes for the target model.
- Search your code for removed parameters: `budget_tokens`, `temperature`, `top_p`, `top_k`, assistant prefill, forced `tool_choice`.
- Set `effort` explicitly. Defaults differ between models (Claude Opus 5.5 defaults to `medium`).
- Re-count tokens if the tokeniser has changed between generations, because the same prompt may use more tokens.
- Review your prompts. Instructions written for older models are often too prescriptive or too emphatic and can reduce quality on newer ones.
- Re-run your evaluation set and compare quality, latency and cost per task.

| Old pattern | Current replacement |
|---|---|
| `thinking: {type: "enabled", budget_tokens: N}` | `thinking: {type: "adaptive"}` plus `output_config.effort` |
| Assistant prefill to force a format | Structured outputs or system prompt instructions |
| `tool_choice: {type: "any"}` | `auto` plus a prompt instruction and `strict: true` |
| `output_format` on `messages.create` | `output_config: {"format": ...}` |
| `temperature` for variety | Instructions and effort |

## 15.7 Managed Agents

So far you have run the agent loop yourself. **Claude Managed Agents** (beta) is a separate surface where Anthropic runs the loop and hosts a per-session sandbox for tool execution.

The model is simple:

1. Create an **agent** once: its model, system prompt and tools. Agents are stored, versioned objects.
2. Start a **session** for each run, referencing the agent. Each session gets its own container where bash, file and code tools execute.
3. Stream the session's events, send messages and return results for any custom tools.

Choose Managed Agents when you want a long-running agent with a workspace, persistent versioned configuration, scheduled runs or multi-agent work, and do not want to host the sandbox yourself. Choose the Messages API with tools when you need to host the compute or keep everything inside your own infrastructure.

> NOTE: Create an agent once and store its ID; do not create agents in the request path. Define agents as version-controlled files and sync them with the `ant` CLI, just as you keep Claude Code configuration in `.claude/`.

## 15.8 Security and data handling

The habits that keep the Larchmont codebase safe apply equally to Claude-powered features.

### Secrets

- Keep API keys in environment variables or a secret store, never in source or config files that are committed.
- Use separate keys for development, test and production, so you can revoke one without breaking the others.
- Restrict who can create keys in the Console, and rotate them on staff changes.

### Personal data

Guest names, emails, phone numbers and payment details are personal data. The project's `docs/privacy-note.md` sets the rules for this codebase. In general:

- Send the minimum data needed. A complaint classifier rarely needs the guest's email address.
- Never send payment card data to a model.
- Check your organisation's data-retention arrangements with Anthropic, and note that some models require standard retention rather than zero data retention.
- Log request IDs and usage, but be careful about logging full prompts that contain personal data.

### Untrusted input

- Treat guest messages, imported CSV rows and fetched web pages as untrusted. They may contain instructions aimed at the model.
- Keep the model's privileges small: read-only tools for read-only jobs, human approval for anything irreversible.
- Validate model output before it reaches your database, exactly as you validate HTTP input.

### Testing

The Larchmont project rules note that in-memory tests cannot prove performance, indexes or concurrency. Similarly, unit tests that mock the Claude client prove your plumbing, not the model's behaviour. Keep a small evaluation set of real (anonymised) examples and run it when you change prompts, models or effort.

> EXERCISE: Take the feedback summariser from Chapter 13. Add a cached system prompt, log the three cache usage figures, and prove with two consecutive requests that the second one reads from the cache.

> EXERCISE: Convert the summariser into a nightly batch job over yesterday's reviews. How will you handle `errored` and `expired` results? Where will results be stored, and how do you match them back to reviews?

> EXERCISE: Write a one-page migration checklist for moving a route from an older model to Claude Opus 5.5. Include a search pattern for each removed parameter.

> EXERCISE: Review `docs/privacy-note.md`. List every guest field the summariser would see, and decide which ones you can strip before sending.

## Key takeaways

- Prompt caching is a byte-exact prefix match; keep stable content first and verify hits with `cache_read_input_tokens`.
- Use Batches for non-urgent work, matching results by `custom_id`.
- Upload reused documents once with the Files API.
- Compaction summarises; context editing clears. With compaction, always append the full response content.
- Optimise cost in order: free wins (caching, hygiene, batches) before trade-offs (effort, model choice), and measure per completed task.
- Migrations break on removed parameters and changed defaults; set effort explicitly and re-run your evaluations.
- Managed Agents runs the loop and the sandbox for you; the Messages API leaves both with you.
- Treat secrets, personal data and untrusted input with the same discipline as the rest of the codebase.
