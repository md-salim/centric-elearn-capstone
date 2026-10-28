# Chapter 2: Core Concepts

Before you can use Claude effectively, whether through Claude Code or the API, you need a working vocabulary. This chapter explains the ideas that every later chapter depends on: tokens, the context window, messages and roles, system prompts, thinking and effort, output limits, stop reasons, streaming, tool use, hallucination and the cost model. None of it requires machine-learning expertise, but all of it affects the quality, speed and price of what you get back.

## Tokens and tokenisers

Claude does not read characters or words directly. Text is split into **tokens**, which are chunks of characters such as whole short words, parts of longer words, punctuation or whitespace. A tokeniser maps text to tokens before the model sees it, and maps tokens back to text afterwards.

Tokens matter for three reasons:

- **Limits** are measured in tokens: the context window, `max_tokens` and rate limits.
- **Price** is measured in tokens: you pay per million input tokens and per million output tokens.
- **Speed** depends on tokens: generating output takes time roughly proportional to the number of output tokens.

As a rough guide, English prose averages somewhere around three to four characters per token, and code is often denser in tokens because of symbols and indentation. Do not rely on rules of thumb for anything important. Different model generations use different tokenisers: the tokeniser introduced with Opus 4.7 and used by later models can produce noticeably more tokens for the same text than the one used by Opus 4.6 and earlier. If you migrate between generations, re-measure.

To measure precisely, use the token-counting endpoint rather than a third-party tokeniser:

```python
import anthropic

client = anthropic.Anthropic()
count = client.messages.count_tokens(
    model="claude-opus-5-5",
    messages=[{"role": "user", "content": open("docs/stakeholder-brief.md").read()}],
)
print(count.input_tokens)
```

> TIP: Never estimate Claude token counts with OpenAI's `tiktoken` or similar libraries. They use a different tokeniser and will give you misleading numbers.

## The context window

The **context window** is the total amount of text, measured in tokens, that the model can consider in a single request. It includes everything: the system prompt, tool definitions, the full conversation history, any documents or images, the model's thinking and its reply.

Current Opus, Sonnet, Fable and Haiku 5.5 models have a 1M-token context window. That is large enough to hold a substantial codebase, but "it fits" is not the same as "it works well". Three practical consequences follow.

1. **Relevance beats volume.** Giving Claude the three files that matter usually produces better results than giving it three hundred files that might matter.
2. **Every turn resends the history.** The API is stateless, so in a long conversation every request includes everything that came before. Costs and latency grow with conversation length.
3. **Long sessions need management.** Claude Code compacts its conversation automatically as it approaches the limit, and you can trigger compaction or clear the context yourself. The API offers server-side compaction (beta) and context editing to drop stale tool results.

> NOTE: In Claude Code, `/clear` starts a fresh context and `/compact` summarises the current one. Clearing between unrelated tasks is one of the simplest ways to get better results and lower costs.

## Messages and roles

A Messages API request contains a list of **messages**. Each message has a **role** and some **content**.

- `user` messages carry your input: questions, instructions, documents, images and tool results.
- `assistant` messages carry Claude's previous replies, including any tool calls it made.

Messages alternate between user and assistant. To continue a conversation you append Claude's last response and your next message, then send the whole list again.

```python
messages = [
    {"role": "user", "content": "What tables does a hotel booking system need?"},
]
first = client.messages.create(model="claude-opus-5-5", max_tokens=16000, messages=messages)

messages.append({"role": "assistant", "content": first.content})  # append the full content, not just text
messages.append({"role": "user", "content": "Now add rate plans and seasonal pricing."})
second = client.messages.create(model="claude-opus-5-5", max_tokens=16000, messages=messages)
```

Content can be a plain string or a list of **content blocks**. Block types include `text`, `image`, `document` (for PDFs and text files), `tool_use`, `tool_result` and `thinking`. A response is also a list of content blocks, so code that reads a response should iterate over the blocks and handle each type, rather than assuming the first block is text.

> WARNING: When continuing a conversation, append `response.content` exactly as you received it. Stripping out thinking or tool-use blocks, or replacing them with plain text, can break features such as thinking continuity and compaction.

## System prompts

The **system prompt** is a separate top-level field that sets the context and ground rules for the whole conversation. It is where you describe the role, the audience, the constraints and the output format.

```python
response = client.messages.create(
    model="claude-opus-5-5",
    max_tokens=16000,
    system=(
        "You are a support assistant for Larchmont Hotels front-desk staff. "
        "Answer in British English. If a question involves refunds over 500 GBP, "
        "tell the user to escalate to the duty manager rather than deciding yourself."
    ),
    messages=[{"role": "user", "content": "A guest wants to cancel a non-refundable booking. What can I do?"}],
)
```

Good system prompts explain *why* as well as *what*. "Escalate refunds over 500 GBP because the hotel's policy requires manager sign-off" generalises better than a bare rule, because Claude can apply the reasoning to cases you did not anticipate.

In Claude Code you rarely write a system prompt directly. Instead, `CLAUDE.md` files, rule files, output styles and agent definitions are loaded into the context to play the same role. Chapter 5 covers this.

Newer models also accept **mid-conversation system messages**: a message with role `system` appended to the message list. This lets an application add an operator instruction part-way through a conversation without editing the top-level system prompt, which keeps the prompt cache intact.

## Thinking and effort

Modern Claude models can **think** before they answer: they produce internal reasoning that improves results on complex tasks such as debugging, planning and maths. You pay for thinking tokens as output tokens, whether or not you see them.

### Adaptive thinking

On current models, thinking is **adaptive**: the model decides when and how much to think based on the difficulty of the request. You enable it with `thinking: {"type": "adaptive"}`, and on several current models it is on by default. The older approach of setting a fixed `budget_tokens` is deprecated, and on the newest models it is rejected with an error.

```python
response = client.messages.create(
    model="claude-opus-5-5",
    max_tokens=16000,
    thinking={"type": "adaptive", "display": "summarized"},
    output_config={"effort": "high"},
    messages=[{"role": "user", "content": "Why might two concurrent bookings both succeed for the last room?"}],
)
for block in response.content:
    if block.type == "thinking":
        print("[thinking summary]", block.thinking)
    elif block.type == "text":
        print(block.text)
```

The raw chain of thought is never returned. On current models the default `display` is `"omitted"`, which returns thinking blocks with empty text; set `"summarized"` if you want a readable summary, for example to show progress in a user interface.

### Effort

**Effort** is the main dial for trading thoroughness against cost and latency. It is set inside `output_config` and takes one of `low`, `medium`, `high`, `xhigh` or `max`.

| Effort | Behaviour | Good for |
|---|---|---|
| `low` | Minimal thinking, fewer and more consolidated tool calls, terse replies | Chat, classification, simple sub-tasks |
| `medium` | Moderate thinking | Routine work where quality holds; the default on Claude Opus 5.5 and Claude Haiku 5.5 |
| `high` | Thorough; the default on most other current models | Intelligence-sensitive work |
| `xhigh` | Deeper still | Most coding and agentic work on the strongest models |
| `max` | Maximum depth | When correctness matters far more than cost |

> NOTE: Claude Opus 5.5 defaults to `medium` effort, one level lower than its predecessor. Set effort explicitly in API code so that your behaviour does not change silently when you switch models. On Claude Opus 5.5 thinking cannot be disabled; if you want faster, cheaper responses, lower the effort.

## max_tokens

`max_tokens` is the hard ceiling on how many tokens Claude may generate in one response, including thinking. If Claude reaches it, the response stops mid-thought with `stop_reason: "max_tokens"`.

Do not set it too low. Truncated answers have to be retried, which costs more than the tokens you were trying to save. Sensible defaults are around 16,000 for non-streaming requests and around 64,000 for streaming requests. Current models support up to 128K output tokens, but values that large require streaming so that the HTTP request does not time out. Go lower only when you have a reason, such as a classifier that returns a single label.

`max_tokens` is not visible to the model; it is simply enforced. If you want Claude to pace a long agentic task within a budget, there is a separate beta feature called task budgets that the model *can* see.

## Stop reasons

Every response includes a `stop_reason` that tells you why generation ended. Check it before you use the content.

| Stop reason | Meaning | What to do |
|---|---|---|
| `end_turn` | Claude finished naturally | Use the response |
| `max_tokens` | Hit the output ceiling | Raise `max_tokens` or ask for a shorter answer; do not trust truncated output |
| `stop_sequence` | Hit a custom stop sequence you supplied | Use the response up to that point |
| `tool_use` | Claude wants to call one or more tools | Run the tools and send back `tool_result` blocks |
| `pause_turn` | A long-running server-side tool turn was paused | Send the conversation back to let Claude continue |
| `refusal` | A safety classifier declined the request | Read `stop_details` for the category; handle gracefully or fall back |

```python
if response.stop_reason == "refusal":
    category = response.stop_details.category if response.stop_details else None
    log.warning("Request declined (category=%s)", category)
elif response.stop_reason == "max_tokens":
    raise RuntimeError("Response truncated; increase max_tokens")
else:
    text = "".join(b.text for b in response.content if b.type == "text")
```

A refusal arrives as a normal HTTP 200 response, not an error, which is exactly why you must check the stop reason. For the strongest models, the API supports server-side **fallbacks**: if a request is declined, it can be retried automatically on another model. Part 5 shows how to enable this.

## Streaming

By default the API returns the whole response at once. With **streaming**, the response arrives incrementally as server-sent events while Claude generates it. Streaming has two benefits:

- **Responsiveness.** Users see text appear immediately instead of waiting for the full reply.
- **Reliability.** Long requests are less likely to hit HTTP timeouts, which is why large `max_tokens` values require streaming.

The SDKs provide helpers so you do not have to assemble events yourself:

```python
with client.messages.stream(
    model="claude-opus-5-5",
    max_tokens=64000,
    messages=[{"role": "user", "content": "Draft an onboarding guide for new receptionists."}],
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
    final = stream.get_final_message()  # complete Message with usage and stop_reason
```

> TIP: If you do not need to display partial output but your request may be long, stream anyway and call `get_final_message()` (Python) or `finalMessage()` (TypeScript) to get the complete response.

## Tool use

**Tool use** (also called function calling) lets Claude ask your code to do things it cannot do alone: query a database, call an internal API, read a file or send an email. It is the mechanism behind every agent, including Claude Code.

The flow works like this:

1. You describe each tool with a name, a description and a JSON Schema for its input.
2. Claude decides a tool would help and responds with `stop_reason: "tool_use"` and one or more `tool_use` blocks containing the arguments.
3. Your code runs the tool and sends the output back in a `tool_result` block in the next user message.
4. Claude uses the result and either calls more tools or gives a final answer.

```python
tools = [{
    "name": "get_occupancy",
    "description": "Return the occupancy percentage for a hotel on a given date.",
    "input_schema": {
        "type": "object",
        "properties": {
            "hotel_id": {"type": "integer"},
            "date": {"type": "string", "description": "ISO date, e.g. 2026-11-03"},
        },
        "required": ["hotel_id", "date"],
        "additionalProperties": False,
    },
    "strict": True,
}]
```

Key points to remember:

- Claude never executes anything itself. Your code decides whether and how to run each call, which is where you put validation and permissions.
- Claude may request several tools in one turn. Run them, then return **all** the results together in a single user message.
- If a tool fails, return a `tool_result` with `is_error: true` and a useful message rather than dropping it.
- Tool descriptions are prompts. A clear description of when to use a tool, and when not to, improves results more than almost anything else.

There are also **server tools** that Anthropic runs for you, such as web search, web fetch and code execution. Chapter 14 covers tools in depth, including the Tool Runner that drives the loop for you.

## Hallucination and verification

Language models can produce fluent, confident statements that are wrong. This is usually called **hallucination**. Typical examples in software work include:

- inventing a method that does not exist in a library, or an option a CLI does not support;
- claiming a test passes without running it;
- misremembering an API version or package name;
- summarising a document and adding a detail that is not in it.

Current models hallucinate far less than earlier ones, especially when they can check their work, but the risk never reaches zero. The cure is verification, built into how you work:

- **Give Claude ways to check itself.** In Claude Code, let it run the build and tests. This repository's hook that builds after every C# edit exists for exactly this reason.
- **Ground answers in sources.** Provide the relevant files or documents and ask Claude to quote or cite them. The API supports citations on document blocks.
- **Ask for evidence, not assertions.** "Show me the test output" is better than "Did the tests pass?".
- **Know the limits of your tests.** The project's `CLAUDE.md` makes this explicit: in-memory tests cannot prove performance, index usage, SQL translation or concurrency behaviour. Claims about those need a test against real MySQL 8.4 or the EF Core SQL log.
- **Allow uncertainty.** Tell Claude it is fine to say "I don't know" or "I couldn't verify this". Models are more likely to guess when the prompt implies a guess is expected.

> WARNING: The most dangerous hallucination in agentic coding is a false claim of completion: "All tests pass" when they were never run. Make running tests part of your definition of done, and read the actual output.

## The cost model

API costs are calculated from token usage. Every response includes a `usage` object that tells you exactly what was consumed.

| Usage field | Meaning |
|---|---|
| `input_tokens` | Uncached input tokens processed |
| `cache_creation_input_tokens` | Input tokens written to the prompt cache |
| `cache_read_input_tokens` | Input tokens served from the prompt cache, at a large discount |
| `output_tokens` | Tokens generated, including thinking |

A worked example on Claude Opus 5.5 at 4 USD per million input tokens and 20 USD per million output tokens:

- A request with 30,000 input tokens and 3,000 output tokens costs 30,000 x 4 / 1,000,000 = 0.12 USD for input plus 3,000 x 20 / 1,000,000 = 0.06 USD for output, so 0.18 USD in total.
- If 25,000 of those input tokens are read from the prompt cache at 0.20 USD per million, the input cost falls to 25,000 x 0.20 / 1,000,000 + 5,000 x 4 / 1,000,000 = 0.005 + 0.02 = 0.025 USD, and the total to about 0.085 USD.

The main levers for reducing cost, roughly in the order you should try them:

1. **Prompt caching.** Put stable content (system prompt, tool definitions, large reference documents) first and mark it for caching. Cache reads cost a fraction of normal input.
2. **Input hygiene.** Send only what is needed; trim stale tool results from long conversations.
3. **Output hygiene.** Ask for concise answers when you do not need prose.
4. **Batch processing.** The Batches API processes non-urgent requests asynchronously at half price.
5. **Effort.** Lower effort where quality holds.
6. **Model choice.** Move suitable routes to a cheaper model, after measuring.

Claude Code users usually see costs through their subscription or the `/cost` and usage views, but the same principles apply: clear context between tasks, keep `CLAUDE.md` focused, and avoid asking Claude to read files it does not need.

## Exercises

> EXERCISE: Use the token-counting endpoint (or ask Claude Code to write a small script that uses it) to count the tokens in `docs/stakeholder-brief.md` and in `backend/Larchmont.Api/Program.cs`. Compare tokens per character for prose and for code.

> EXERCISE: Write a short Python or TypeScript program that sends the same question to Claude Opus 5.5 at `low` and `high` effort and prints `usage.output_tokens` and the answer for each. What changed?

> EXERCISE: Extend your program to handle every stop reason in the table above. Force a `max_tokens` stop by setting `max_tokens` to 50 and confirm your handling works.

> EXERCISE: Design a tool definition called `find_available_rooms` for the Larchmont system. Decide on its inputs, write a description that explains when Claude should and should not use it, and mark it `strict`.

> EXERCISE: Recall a time an AI assistant gave you a wrong answer. Which verification technique from this chapter would have caught it?

## Key takeaways

- Tokens are the unit of limits, price and speed; measure them with the counting endpoint, not guesswork.
- The context window holds everything, including history, thinking and the reply. Relevant context beats more context.
- Messages alternate between user and assistant; always append the full response content when continuing.
- System prompts (or `CLAUDE.md` in Claude Code) set the ground rules; explain the reasons behind rules.
- Use adaptive thinking and steer depth with effort; set effort explicitly, especially on Claude Opus 5.5.
- Do not lowball `max_tokens`, always check `stop_reason`, and handle `refusal` gracefully.
- Stream long requests; use the SDK helpers to get the final message.
- Tool use is how Claude acts in the world, and your code stays in control of execution.
- Verify everything that matters: build, test, cite and read real output.
- Cost is driven by tokens; caching, hygiene and batching come before trading quality for price.
