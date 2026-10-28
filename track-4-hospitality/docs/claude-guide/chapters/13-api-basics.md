# Chapter 13: The Claude API — Fundamentals

Claude Code is one way to work with Claude: an agent that already knows how to read files, run commands and edit code. The Claude API is the layer underneath. When you want Claude inside your own product — summarising guest feedback, drafting replies to booking enquiries, classifying channel-manager errors — you call the API directly. This chapter covers everything you need to make your first useful requests and to understand what comes back.

By the end of this chapter you should be able to authenticate, install an SDK, send single and multi-turn requests, control thinking and effort, read stop reasons correctly, handle errors in the right order, stream long responses and discover model capabilities at run time.

## 13.1 The shape of the API

Almost everything goes through a single endpoint: `POST /v1/messages`. Tools, structured outputs, images, PDFs, thinking and caching are not separate APIs; they are features of that one request. A small set of supporting endpoints sits around it:

| Endpoint | Purpose |
|---|---|
| `POST /v1/messages` | Send a conversation, receive Claude's next turn |
| `POST /v1/messages/count_tokens` | Count the input tokens a request would use, without running it |
| `POST /v1/messages/batches` | Submit many requests for asynchronous processing at reduced cost |
| `POST /v1/files` | Upload a file once and reference it by ID in later requests |
| `GET /v1/models` | List models and their capabilities (context window, output cap) |

The most important property of the Messages API is that it is **stateless**. The server does not remember your previous request. Every call must carry the whole conversation you want Claude to see. This is liberating — you control exactly what Claude knows — but it also means you are responsible for history management, and that history size drives cost.

> NOTE: "Stateless" refers to the Messages API. Managed Agents (Chapter 15) is a separate, stateful surface where Anthropic stores sessions for you.

## 13.2 Authentication

The SDKs resolve credentials automatically, in this order (first match wins):

1. The `ANTHROPIC_API_KEY` environment variable.
2. The `ANTHROPIC_AUTH_TOKEN` environment variable.
3. The active OAuth profile created by `ant auth login` (or the profile named in `ANTHROPIC_PROFILE`).
4. Workload Identity Federation environment variables, for cloud workloads.
5. The default profile on disk.

The practical consequence: an unset `ANTHROPIC_API_KEY` does not mean you have no credentials. If you have run `ant auth login`, a bare client constructor will simply work.

```bash
# Option 1: log in once with the Anthropic CLI (stores a profile under ~/.config/anthropic/)
ant auth login
ant auth status

# Option 2: export an API key for this shell only
export ANTHROPIC_API_KEY="sk-ant-..."
```

> WARNING: Never hard-code an API key in source, a `.env` file that is committed, `appsettings.json`, or a CLAUDE.md file. The project rules for Larchmont already forbid committing secrets; API keys are secrets in exactly the same way as database passwords.

> TIP: If an `ANTHROPIC_API_KEY` is set in your environment, it takes priority over your login profile. When authentication behaves unexpectedly, run `ant auth status` to see which source is actually in use.

## 13.3 Installing an SDK

Anthropic publishes official SDKs for Python, TypeScript/JavaScript, Java (also used from Kotlin and Scala), Go, Ruby, C# and PHP. Always prefer the official SDK over raw HTTP: it handles retries, timeouts, streaming, typed responses and error classes for you.

| Language | Install command |
|---|---|
| Python | `pip install anthropic` |
| TypeScript / JavaScript | `npm install @anthropic-ai/sdk` |
| C# / .NET | `dotnet add package Anthropic` |
| Go | `go get github.com/anthropics/anthropic-sdk-go` |
| Java | Add `com.anthropic:anthropic-java` to Maven or Gradle |

## 13.4 Your first request

A Messages request needs three things: a `model`, a `max_tokens` ceiling, and a list of `messages`. The examples below all use `claude-opus-5-5`, the current default Opus model.

### Python

```python
import anthropic

client = anthropic.Anthropic()  # resolves credentials from the environment

response = client.messages.create(
    model="claude-opus-5-5",
    max_tokens=16000,
    messages=[
        {"role": "user", "content": "Suggest three names for a boutique hotel in York."}
    ],
)

# response.content is a list of content blocks; check .type before reading .text
for block in response.content:
    if block.type == "text":
        print(block.text)
```

### TypeScript

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-opus-5-5",
  max_tokens: 16000,
  messages: [{ role: "user", content: "Suggest three names for a boutique hotel in York." }],
});

for (const block of response.content) {
  if (block.type === "text") {
    console.log(block.text);
  }
}
```

### C#

Because the Larchmont API is ASP.NET Core, the C# SDK is the one you are most likely to use in this codebase.

```csharp
using System;
using System.Linq;
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();   // reads ANTHROPIC_API_KEY

var response = await client.Messages.Create(new MessageCreateParams
{
    Model = "claude-opus-5-5",
    MaxTokens = 16000,
    Messages = [new UserMessageParam { Content = "Suggest three names for a boutique hotel in York." }],
});

foreach (var text in response.Content.Select(b => b.Value).OfType<TextBlock>())
{
    Console.WriteLine(text.Text);
}
```

### Reading the response

A response is a message object with several fields worth knowing:

| Field | Meaning |
|---|---|
| `id` | Unique message ID |
| `model` | The model that actually produced the response |
| `content` | A list of content blocks: `text`, `thinking`, `tool_use` and others |
| `stop_reason` | Why generation stopped (see 13.8) |
| `usage` | Token counts: `input_tokens`, `output_tokens`, cache read and write counts |

> WARNING: Do not write `response.content[0].text`. The first block is not guaranteed to be text — with thinking enabled it will often be a `thinking` block. Always iterate and check the block type.

> TIP: Every Python response exposes `_request_id`. Log it. When you need to report a problem to Anthropic, the request ID is the single most useful piece of information.

## 13.5 System prompts

The `system` parameter sets the role, tone, rules and background knowledge Claude should apply to the whole conversation. It sits outside the `messages` list.

```python
response = client.messages.create(
    model="claude-opus-5-5",
    max_tokens=16000,
    system=(
        "You are the guest-relations assistant for Larchmont Hotels, a group of six UK hotels. "
        "Reply in British English. Be warm and concise. Never promise refunds; "
        "say a manager will review the request."
    ),
    messages=[{"role": "user", "content": "My room was cold all night and nobody came."}],
)
```

Good system prompts have much in common with good CLAUDE.md files (Chapter 3):

- State who Claude is acting as and who the reader is.
- Give the reason behind each rule, not just the rule. Claude generalises better from intent.
- Prefer clear, specific instructions over shouting. Capital letters and repeated "IMPORTANT" warnings were a habit for older models; current models follow calm, precise instructions well and can over-apply emphatic ones.
- Keep stable content first and volatile content last, because that is what makes prompt caching work (Chapter 15).

> NOTE: Some newer models also accept `{"role": "system", ...}` entries inside the `messages` list for instructions that arrive mid-conversation. This keeps the cached prefix intact. Use the top-level `system` field for anything that is known at the start.

## 13.6 Multi-turn conversations

Because the API is stateless, a conversation is just a list you keep appending to. Messages alternate between `user` and `assistant`, and the first must be `user`.

```python
class Conversation:
    def __init__(self, client, system):
        self.client = client
        self.system = system
        self.messages = []

    def send(self, text: str) -> str:
        self.messages.append({"role": "user", "content": text})
        response = self.client.messages.create(
            model="claude-opus-5-5",
            max_tokens=16000,
            system=self.system,
            messages=self.messages,
        )
        # Append the full content, not just the text, so nothing is lost
        self.messages.append({"role": "assistant", "content": response.content})
        return "".join(b.text for b in response.content if b.type == "text")

chat = Conversation(anthropic.Anthropic(), "You help reception staff with booking questions.")
print(chat.send("A guest wants to extend from two nights to four. What should I check?"))
print(chat.send("And if the room type is sold out for the extra nights?"))
```

> TIP: Append `response.content` (the full list of blocks) rather than only the text. Thinking blocks, tool calls and compaction blocks all need to travel back to the API on the next turn for the conversation to stay valid.

> WARNING: Treat the history as append-only. Editing or deleting earlier turns can invalidate thinking blocks on current models and always destroys the prompt cache after the edit point. If you must trim history, use the compaction or context-editing features described in Chapter 15.

## 13.7 Thinking and effort

Current Claude models reason before answering. You control two separate things: whether reasoning is shown, and how much effort Claude spends.

### Adaptive thinking

Adaptive thinking lets Claude decide when and how much to think. On Claude Opus 5.5, thinking is always on: you either omit the `thinking` parameter or send `{"type": "adaptive"}`, which is equivalent.

```python
response = client.messages.create(
    model="claude-opus-5-5",
    max_tokens=16000,
    thinking={"type": "adaptive", "display": "summarized"},
    output_config={"effort": "high"},
    messages=[{"role": "user", "content": "Design an overbooking policy for a 120-room hotel."}],
)

for block in response.content:
    if block.type == "thinking":
        print("Reasoning summary:", block.thinking)
    elif block.type == "text":
        print("Answer:", block.text)
```

The `display` setting controls visibility only. With the default (`"omitted"`) thinking still happens and is still billed, but the thinking text comes back empty. Set `"summarized"` if you want a readable summary — for example, to show users that work is in progress.

> WARNING: Older tutorials show `thinking: {"type": "enabled", "budget_tokens": N}`. On Claude Opus 5.5 and the other current-generation models this returns a 400 error. Use adaptive thinking and `effort` instead.

### Effort

Effort lives inside `output_config`, not at the top level. It trades thoroughness against token spend.

| Effort | When to use it |
|---|---|
| `low` | Simple classification, chat, sub-tasks, latency-sensitive routes |
| `medium` | Routine work; the default on Claude Opus 5.5 |
| `high` | Intelligence-sensitive work, multi-step reasoning, most agentic tasks |
| `xhigh` | Hard coding and long-horizon agentic tasks |
| `max` | When correctness matters more than cost |

> NOTE: Claude Opus 5.5 defaults to `medium` effort, one level lower than Claude Opus 5's default of `high`. If you are migrating code and quality drops, set effort explicitly before anything else.

### Other removed parameters

Two other patterns from older material no longer work on current models:

- **Assistant prefill** (ending `messages` with a partial assistant turn to steer the format) returns a 400. Use structured outputs (Chapter 14) or system prompt instructions instead.
- **Sampling parameters** (`temperature`, `top_p`, `top_k`) are rejected on current models. Steer behaviour with instructions and effort.

## 13.8 Stop reasons

Always check `stop_reason` before you use a response. It tells you whether you have a complete answer.

| `stop_reason` | Meaning | What to do |
|---|---|---|
| `end_turn` | Claude finished naturally | Use the response |
| `max_tokens` | Hit your `max_tokens` ceiling | Output is truncated; raise the limit or stream |
| `stop_sequence` | Hit a custom stop sequence | Use the response up to that point |
| `tool_use` | Claude wants to call a tool | Run the tool, return the result (Chapter 14) |
| `pause_turn` | A long server-tool turn paused | Append the response and send again to continue |
| `refusal` | A safety classifier declined the request | Read `stop_details`; do not treat content as an answer |

### Handling refusals

When `stop_reason` is `"refusal"`, the response carries a `stop_details` object with a `category` (for example `"cyber"` or `"bio"`, or `null`) and an `explanation`. For every other stop reason `stop_details` is `null`, so guard before reading it.

```python
if response.stop_reason == "refusal":
    details = response.stop_details
    log.warning("Refused: category=%s explanation=%s",
                details.category if details else None,
                details.explanation if details else None)
    return fallback_message()
```

Current Opus, Sonnet and Fable models support a server-side `fallbacks` parameter (behind a beta header) that automatically re-runs a declined request on a fallback model within the same call. The exact header and form differ between models, so check the current documentation before relying on it.

> TIP: In a hotel system, legitimate requests very rarely trigger refusals. If you see them, inspect the prompt: retrieved guest text sometimes contains content that looks unusual out of context.

## 13.9 Error handling

The SDKs raise typed exceptions. Catch them from most specific to most general so that you can distinguish retryable failures (rate limits, server errors, network problems) from ones that will never succeed (bad requests, authentication).

```python
import anthropic

try:
    response = client.messages.create(
        model="claude-opus-5-5",
        max_tokens=16000,
        messages=messages,
    )
except anthropic.BadRequestError as e:          # 400: fix the request, do not retry
    log.error("Bad request: %s", e.message)
    raise
except anthropic.AuthenticationError:           # 401: credentials problem
    log.error("Invalid or missing API key")
    raise
except anthropic.PermissionDeniedError:         # 403
    log.error("Key lacks permission for this resource")
    raise
except anthropic.NotFoundError:                 # 404: wrong model ID or endpoint
    log.error("Model or endpoint not found")
    raise
except anthropic.RateLimitError as e:           # 429: back off and retry
    retry_after = int(e.response.headers.get("retry-after", "60"))
    schedule_retry(retry_after)
except anthropic.APIStatusError as e:           # other HTTP errors, including 5xx
    if e.status_code >= 500:
        schedule_retry(30)
    else:
        raise
except anthropic.APIConnectionError:            # network failure, DNS, TLS
    schedule_retry(10)
```

| Status | Exception (Python) | Retry? |
|---|---|---|
| 400 | `BadRequestError` | No — the request is wrong |
| 401 | `AuthenticationError` | No — fix credentials |
| 403 | `PermissionDeniedError` | No |
| 404 | `NotFoundError` | No — check the model ID |
| 429 | `RateLimitError` | Yes, after `retry-after` |
| 5xx | `APIStatusError` (status 500 and above) | Yes, with backoff |
| — | `APIConnectionError` | Yes, with backoff |

> NOTE: The SDKs already retry connection errors, 408, 409, 429 and 5xx responses with exponential backoff (two retries by default). Configure `max_retries` rather than writing your own loop unless you need different behaviour.

> WARNING: Never match on error message strings. Messages change; exception classes and status codes are the stable contract.

### Timeouts

The default request timeout is ten minutes. The unit differs by SDK, which is a common source of bugs:

| SDK | Timeout unit |
|---|---|
| Python, Ruby | Seconds |
| TypeScript | Milliseconds |
| C# | `TimeSpan` |
| Java | `Duration` |
| Go | `time.Duration` |

Remember that timeouts are retried, so worst-case wall-clock time is roughly `timeout × (max_retries + 1)`.

## 13.10 Streaming

For anything with long input, long output or a high `max_tokens`, stream. Streaming shows progress to users and avoids HTTP timeouts on long generations.

```python
with client.messages.stream(
    model="claude-opus-5-5",
    max_tokens=64000,
    messages=[{"role": "user", "content": "Write a staff induction guide for night reception."}],
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)

    final = stream.get_final_message()   # the complete message, with usage and stop_reason

print("\nStop reason:", final.stop_reason)
print("Output tokens:", final.usage.output_tokens)
```

If you do not need individual events but still want the timeout protection, open a stream and call `get_final_message()` (`finalMessage()` in TypeScript) straight away.

### Stream events

Under the helper, the server sends server-sent events. You only need these if you build your own UI handling:

| Event | Meaning |
|---|---|
| `message_start` | A new message has begun |
| `content_block_start` | A new block (text, thinking, tool_use) has begun |
| `content_block_delta` | A fragment of the current block (`text_delta`, `thinking_delta`, `input_json_delta`) |
| `content_block_stop` | The current block is complete |
| `message_delta` | Top-level changes, including the final `stop_reason` and usage |
| `message_stop` | The message is complete |

## 13.11 Choosing `max_tokens`

`max_tokens` is a hard ceiling on output, and Claude is not told about it. If it is too low, the response is cut off mid-thought and you pay for a retry.

| Situation | Suggested `max_tokens` |
|---|---|
| Non-streaming general requests | About 16,000 |
| Streaming requests | About 64,000 |
| Classification or very short answers | About 256 |
| Very long documents or code generation | Up to 128,000 on current models, streaming only |

> TIP: Thinking tokens count towards output. A request with high effort on a hard problem may need far more room than the visible answer suggests.

## 13.12 Counting tokens

Use the token counting endpoint to estimate cost and check that a prompt fits before you send it.

```python
count = client.messages.count_tokens(
    model="claude-opus-5-5",
    system=system_prompt,
    messages=messages,
)
print("Input tokens:", count.input_tokens)
```

> WARNING: Do not estimate Claude token counts with third-party tokenisers built for other model families. They are wrong for Claude, and tokenisers differ between Claude generations too.

## 13.13 Discovering models at run time

The Models API returns each model's ID, display name, creation date, context window (`max_input_tokens`), output cap (`max_tokens`) and capabilities.

```python
for model in client.models.list():
    print(model.id, model.display_name, model.max_input_tokens, model.max_tokens)

opus = client.models.retrieve("claude-opus-5-5")
print(opus.capabilities)
```

### Current model line-up

| Model | ID | Typical use |
|---|---|---|
| Claude Fable 5.1 | `claude-fable-5-1` | Most demanding reasoning and long-horizon agentic work |
| Claude Opus 5.5 | `claude-opus-5-5` | Default choice for most serious work |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | Fast, capable everyday coding and agent work |
| Claude Haiku 5.5 | `claude-haiku-5-5` | High-volume, simple, latency-sensitive tasks |

> WARNING: Use model IDs exactly as published. Do not append date suffixes you half-remember from older material, and do not construct IDs by pattern. If in doubt, list the models.

## 13.14 Worked example: summarising guest feedback

Here is a small but complete function in the style you might use behind a Larchmont service class. It combines a system prompt, a moderate effort level, stop-reason checks and typed error handling.

```python
import anthropic

client = anthropic.Anthropic()

SYSTEM = (
    "You summarise hotel guest feedback for duty managers. "
    "Write in British English. Produce three short bullet points: "
    "what went well, what went badly, and one suggested action."
)

def summarise_feedback(feedback_text: str) -> str:
    try:
        response = client.messages.create(
            model="claude-opus-5-5",
            max_tokens=2000,
            system=SYSTEM,
            output_config={"effort": "low"},
            messages=[{"role": "user", "content": feedback_text}],
        )
    except anthropic.RateLimitError:
        return "Summary unavailable (rate limited). Please try again shortly."
    except anthropic.APIConnectionError:
        return "Summary unavailable (network error)."

    if response.stop_reason == "refusal":
        return "Summary unavailable for this feedback."
    if response.stop_reason == "max_tokens":
        # Rare at this size, but never present a truncated summary as complete
        return "Summary truncated. Please review the original feedback."

    return "".join(b.text for b in response.content if b.type == "text")
```

> EXERCISE: Port `summarise_feedback` to C# as a method on a new `FeedbackSummaryService`. Keep the API key out of `appsettings.json`, register the `AnthropicClient` through dependency injection, and write a unit test that mocks the service boundary rather than calling the real API.

> EXERCISE: Add a `count_tokens` call before the request and refuse to summarise any feedback longer than 20,000 input tokens. What should the user see in that case?

> EXERCISE: Run the same summary request at `low`, `medium` and `high` effort on five real pieces of feedback. Compare quality, latency and `usage.output_tokens`. Which would you ship, and why?

## Key takeaways

- Everything goes through `POST /v1/messages`, and the API is stateless: you send the whole conversation each time.
- Credentials come from the environment or an `ant auth login` profile. Never hard-code keys.
- Iterate over content blocks and check their types; never assume `content[0]` is text.
- On current models use adaptive thinking and `output_config.effort`. `budget_tokens`, prefill and sampling parameters are rejected.
- Check `stop_reason` on every response, and handle `max_tokens` and `refusal` explicitly.
- Catch errors from most specific to most general; retry only 429, 5xx and connection errors.
- Stream anything long, and do not set `max_tokens` too low.
