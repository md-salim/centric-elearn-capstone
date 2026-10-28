# Chapter 14: Tool Use and Structured Outputs

A model that can only produce text is limited to what it already knows. Tool use lets Claude ask your code to do things: look up a booking, check availability, calculate a rate. Structured outputs let you receive machine-readable JSON that is guaranteed to match a schema. Together they turn Claude from a chat partner into a component you can build on.

Claude Code itself is built on exactly these mechanisms. Every time you watch it call `Read`, `Grep` or `Bash`, you are watching the tool-use loop described in this chapter.

## 14.1 How tool use works

Tool use is a conversation between Claude and your code, mediated by the Messages API:

1. You send a request that includes a list of `tools`, each with a name, a description and a JSON Schema for its input.
2. Claude decides whether a tool would help. If so, it returns a response with `stop_reason: "tool_use"` and one or more `tool_use` blocks, each carrying an `id`, a `name` and an `input` object.
3. Your code runs the tool and sends back a new `user` message containing `tool_result` blocks, each referencing the matching `tool_use_id`.
4. Claude reads the results and either calls more tools or writes a final answer with `stop_reason: "end_turn"`.

> NOTE: Claude never executes your tools itself. It only asks. Your code decides whether to run the call, which makes tool use a natural place to enforce permissions, validation and audit logging.

### Client tools and server tools

| Kind | Who runs it | Examples |
|---|---|---|
| Client (user-defined) tools | Your code | `get_booking`, `check_availability`, `send_email` |
| Server tools | Anthropic's infrastructure | Web search, web fetch, code execution |
| Anthropic-defined client tools | Your code, with a schema Anthropic defines | Bash, text editor, memory |

## 14.2 Defining a tool

A tool definition has three parts. The description matters more than most people expect: it is the only guidance Claude has about when and how to use the tool.

```python
check_availability = {
    "name": "check_availability",
    "description": (
        "Check how many rooms of a given room type are free at a Larchmont hotel "
        "for a date range. Use this before quoting availability to a guest. "
        "Dates are ISO 8601 (YYYY-MM-DD); check_out is exclusive."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "hotel_id": {"type": "integer", "description": "Larchmont hotel ID, 1 to 6"},
            "room_type": {"type": "string", "description": "Room type code, e.g. 'DBL' or 'STE'"},
            "check_in": {"type": "string", "format": "date"},
            "check_out": {"type": "string", "format": "date"},
        },
        "required": ["hotel_id", "room_type", "check_in", "check_out"],
        "additionalProperties": False,
    },
}
```

Guidelines for good tool definitions:

- Name tools with verbs that say what they do: `get_booking`, not `booking`.
- Describe when to use the tool, not only what it returns.
- State units, formats and edge cases (inclusive or exclusive dates, currency, time zone).
- Keep the tool set small and distinct. Two tools with overlapping purposes confuse the model.
- Return compact, relevant results. A tool that dumps an entire table wastes context.

## 14.3 The manual tool-use loop

The manual loop is the clearest way to understand tool use. In production you will often use the Tool Runner instead (14.4), but you should be able to write this by hand.

```python
import json
import anthropic

client = anthropic.Anthropic()
tools = [check_availability]

def execute_tool(name: str, tool_input: dict) -> str:
    if name == "check_availability":
        free = availability_service.free_rooms(**tool_input)   # your own service layer
        return json.dumps({"free_rooms": free})
    raise ValueError(f"Unknown tool: {name}")

messages = [{"role": "user", "content": "Do you have a double room at hotel 2 from 3 to 5 March 2027?"}]

while True:
    response = client.messages.create(
        model="claude-opus-5-5",
        max_tokens=16000,
        tools=tools,
        messages=messages,
    )

    if response.stop_reason == "end_turn":
        break

    if response.stop_reason == "pause_turn":
        # A long server-tool turn paused; send it back so the server can continue
        messages.append({"role": "assistant", "content": response.content})
        continue

    if response.stop_reason != "tool_use":
        # max_tokens or refusal: stop rather than running half-formed tool calls
        break

    messages.append({"role": "assistant", "content": response.content})

    tool_results = []
    for block in response.content:
        if block.type != "tool_use":
            continue
        try:
            result = execute_tool(block.name, block.input)
            tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": result})
        except Exception as exc:
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": f"Error: {exc}",
                "is_error": True,
            })

    # All results for this turn go back in a single user message
    messages.append({"role": "user", "content": tool_results})

print("".join(b.text for b in response.content if b.type == "text"))
```

Points to notice:

- The assistant turn, including its `tool_use` blocks, is appended to history before the results.
- Every `tool_use` block gets a `tool_result` with the matching `tool_use_id`. Missing one is an error.
- Failed tools return `is_error: True` with a helpful message. Do not drop them; Claude can often recover by trying different input.
- The loop checks `stop_reason` before running tools, so a truncated (`max_tokens`) or refused turn never triggers side effects.

> WARNING: Always parse `block.input` as structured data (the SDK gives you a dict). Never string-match on the serialised JSON: escaping of Unicode and slashes can vary between models.

## 14.4 The Tool Runner

The SDKs include a beta **Tool Runner** that runs the loop for you. You write plain functions; the SDK generates schemas, calls the API, executes tools and feeds results back until Claude has finished.

```python
import anthropic
from anthropic import beta_tool

client = anthropic.Anthropic()

@beta_tool
def check_availability(hotel_id: int, room_type: str, check_in: str, check_out: str) -> str:
    """Check how many rooms of a room type are free at a Larchmont hotel.

    Args:
        hotel_id: Larchmont hotel ID, 1 to 6.
        room_type: Room type code, e.g. 'DBL' or 'STE'.
        check_in: Arrival date, YYYY-MM-DD.
        check_out: Departure date, YYYY-MM-DD (exclusive).
    """
    free = availability_service.free_rooms(hotel_id, room_type, check_in, check_out)
    return f"{free} rooms free"

runner = client.beta.messages.tool_runner(
    model="claude-opus-5-5",
    max_tokens=16000,
    tools=[check_availability],
    messages=[{"role": "user", "content": "Is a suite free at hotel 4 next Friday night?"}],
)

final = runner.until_done()
print("".join(b.text for b in final.content if b.type == "text"))
```

The Tool Runner exists in all the official SDKs (`betaZodTool` in TypeScript, `BetaToolRunner` in C#, and equivalents elsewhere). It still lets you inspect each turn, so approval gates and logging do not require a manual loop: you can gate inside the tool function itself and return a "declined by user" result.

> NOTE: The Tool Runner and the Claude Agent SDK are different things. The Tool Runner loops over tools you define, and nothing else. The Agent SDK is Claude Code packaged as a library, with built-in file, shell and search tools.

### When to choose which

| Approach | Choose it when |
|---|---|
| Tool Runner | Most custom-tool agents; you want less code and built-in hooks |
| Manual loop | You need full control, a custom transport or no beta dependency |
| Claude Agent SDK | You want a ready-made coding or file-system agent running on your infrastructure |
| Managed Agents | You want Anthropic to run the loop and host the sandbox (Chapter 15) |

## 14.5 Parallel tool calls

Claude can request several tools in one turn — for example, availability at three hotels at once. Run them concurrently if you can, then return **all** results in a **single** user message.

```python
import concurrent.futures

tool_blocks = [b for b in response.content if b.type == "tool_use"]

with concurrent.futures.ThreadPoolExecutor() as pool:
    futures = {pool.submit(execute_tool, b.name, b.input): b for b in tool_blocks}
    results = []
    for future, block in futures.items():
        try:
            results.append({"type": "tool_result", "tool_use_id": block.id, "content": future.result()})
        except Exception as exc:
            results.append({"type": "tool_result", "tool_use_id": block.id,
                            "content": f"Error: {exc}", "is_error": True})

messages.append({"role": "assistant", "content": response.content})
messages.append({"role": "user", "content": results})
```

> WARNING: Splitting parallel results across several user messages silently teaches Claude to stop making parallel calls, which makes your agent slower. One turn of calls, one message of results.

If a tool must never run concurrently with itself (because it writes to shared state), set `disable_parallel_tool_use` on `tool_choice` to allow at most one call per turn.

## 14.6 Tool choice and steering

By default `tool_choice` is `{"type": "auto"}`: Claude decides whether to call a tool. Older models also accepted forcing modes (`{"type": "any"}` and `{"type": "tool", "name": ...}`).

> WARNING: Forced tool choice (`any` or a named `tool`) returns a 400 on Claude Opus 5.5, Claude Sonnet 5.5 and Claude Fable 5.1. Use `auto` with a clear instruction in the prompt, and add `strict: true` to the tool so that any call it does make is schema-valid.

```python
response = client.messages.create(
    model="claude-opus-5-5",
    max_tokens=16000,
    tools=[{**check_availability, "strict": True}],
    messages=[{
        "role": "user",
        "content": "Use the check_availability tool to see whether hotel 2 has a DBL free from 2027-03-03 to 2027-03-05.",
    }],
)

if not any(b.type == "tool_use" for b in response.content):
    # auto does not guarantee a call; re-prompt or handle the text answer
    ...
```

`{"type": "none"}` still works everywhere if you want to stop Claude calling tools for a turn.

If the only reason you were forcing a tool was to get JSON back, use structured outputs instead (14.8). It is the right tool for that job.

## 14.7 Strict tool use

Setting `strict: true` at the top level of a tool definition guarantees that `tool_use.input` validates exactly against the schema. The schema must set `additionalProperties: false` and list `required` fields.

```python
book_room = {
    "name": "create_booking",
    "description": "Create a provisional booking. Only call after the guest has confirmed.",
    "strict": True,
    "input_schema": {
        "type": "object",
        "properties": {
            "hotel_id": {"type": "integer"},
            "room_type": {"type": "string", "enum": ["SGL", "DBL", "TWN", "STE"]},
            "check_in": {"type": "string", "format": "date"},
            "check_out": {"type": "string", "format": "date"},
            "guests": {"type": "integer", "enum": [1, 2, 3, 4]},
        },
        "required": ["hotel_id", "room_type", "check_in", "check_out", "guests"],
        "additionalProperties": False,
    },
}
```

> NOTE: Strict schemas guarantee shape, not truth. Claude can still pass a check-out date earlier than the check-in date. Your service layer must validate business rules — exactly as the Larchmont FluentValidation validators do for HTTP requests.

## 14.8 Structured outputs

Structured outputs constrain the final response itself to a JSON Schema, set through `output_config.format`. This is the reliable way to extract data.

### With a Pydantic model (recommended in Python)

```python
from typing import List
from pydantic import BaseModel
import anthropic

class Complaint(BaseModel):
    hotel_name: str
    category: str          # e.g. "cleanliness", "noise", "billing"
    severity: int          # 1 (minor) to 5 (serious)
    requested_action: str
    mentions_staff: bool
    keywords: List[str]

client = anthropic.Anthropic()

response = client.messages.parse(
    model="claude-opus-5-5",
    max_tokens=4000,
    messages=[{
        "role": "user",
        "content": "Extract the complaint: 'Stayed at Larchmont Harrogate. Bathroom was dirty and "
                   "nobody answered reception at 2am. I'd like a partial refund.'",
    }],
    output_format=Complaint,
)

complaint = response.parsed_output    # a validated Complaint instance
print(complaint.category, complaint.severity)
```

### With a raw JSON Schema

```python
import json

response = client.messages.create(
    model="claude-opus-5-5",
    max_tokens=4000,
    messages=[{"role": "user", "content": "Extract: Jane Doe, arriving 2027-04-01 for 3 nights, 2 adults."}],
    output_config={
        "format": {
            "type": "json_schema",
            "schema": {
                "type": "object",
                "properties": {
                    "guest_name": {"type": "string"},
                    "arrival": {"type": "string", "format": "date"},
                    "nights": {"type": "integer"},
                    "adults": {"type": "integer"},
                },
                "required": ["guest_name", "arrival", "nights", "adults"],
                "additionalProperties": False,
            },
        }
    },
)

text = next(b.text for b in response.content if b.type == "text")
data = json.loads(text)
```

> WARNING: The older top-level `output_format` parameter on `messages.create()` is deprecated. Use `output_config: {"format": {...}}`. Structured outputs are also incompatible with citations; you cannot enable both on the same request.

### Structured outputs or tools?

| Need | Use |
|---|---|
| Claude's final answer as validated JSON | Structured outputs (`output_config.format`) |
| Claude to fetch data or take actions | Tools |
| Both: actions, then a JSON summary | Tools with `strict: true` plus `output_config.format` on the same request |

## 14.9 Server tools

Server tools run on Anthropic's infrastructure. You declare them in `tools` and results arrive as content blocks in the same response; there is no function for you to implement.

| Tool | `type` on current models | Notes |
|---|---|---|
| Web search | `web_search_20260209` | Optional `max_uses`, `allowed_domains` or `blocked_domains`, `user_location` |
| Web fetch | `web_fetch_20260209` | Only fetches URLs already present in the conversation |
| Code execution | `code_execution_20260521` | Sandboxed execution; output arrives as `bash_code_execution_tool_result` |

```python
response = client.messages.create(
    model="claude-opus-5-5",
    max_tokens=16000,
    tools=[{
        "type": "web_search_20260209",
        "name": "web_search",
        "max_uses": 3,
        "allowed_domains": ["visitbritain.com"],
    }],
    messages=[{"role": "user", "content": "What major events are on in York in December?"}],
)
```

Things to know:

- Server-tool errors do not raise exceptions. They come back as HTTP 200 with a result block whose content is an error object. Check before indexing.
- A long server-tool turn can end with `stop_reason: "pause_turn"`. Append the response and send it again to let the server continue.
- The current web search and fetch variants include dynamic filtering, which uses code execution internally. Do not also declare `code_execution` alongside them.

## 14.10 MCP and the API

The Model Context Protocol (Chapter 8) is how Claude Code connects to external systems. You can use MCP from the API too, in two ways:

- **The MCP connector**: pass `mcp_servers` with a remote server URL and a matching `mcp_toolset` entry in `tools`, plus the beta header. Claude talks to the remote server directly.
- **SDK conversion helpers**: connect to a local MCP server yourself and convert its tools into Tool Runner tools (for example `async_mcp_tool` in Python).

> TIP: The connector needs both halves — the `mcp_servers` entry and the `mcp_toolset` tool. Supplying only the server is a validation error.

## 14.11 Security for tool-using applications

Tools turn model output into actions, so treat tool inputs as untrusted.

- **Validate every input** against business rules in your service layer, even with `strict: true`.
- **Confine file paths** to a known root before reading or writing. A model-supplied path is untrusted output.
- **Use least privilege.** A read-only reporting tool should connect with a read-only database user, as Larchmont's `db-setup` scripts do.
- **Gate destructive actions.** Require human approval for cancellations, refunds and anything irreversible.
- **Beware prompt injection.** Text returned by tools — guest emails, web pages, CSV imports — can contain instructions. Claude is trained to resist them, but your design should not rely on that alone: never give a tool that reads untrusted content the ability to act without checks.
- **Log tool calls** with their inputs and the request ID, so you can audit what happened.

> EXERCISE: Design three tools for a "front-desk assistant": `find_guest`, `get_booking` and `extend_booking`. Write the JSON Schemas with `strict: true`. Which one needs a human approval gate, and how would you implement it in the Tool Runner?

> EXERCISE: Write a manual loop that deliberately returns `is_error: True` for any `hotel_id` above 6. Observe how Claude recovers. Then improve the tool description so that the error happens less often.

> EXERCISE: Use structured outputs to convert ten rows of `docs/sample-channel-export.csv` into a typed list of bookings. Compare the result with what the Larchmont CSV importer produces. Where do they disagree, and which is right?

## Key takeaways

- Tool use is a loop: Claude asks with `tool_use`, your code answers with `tool_result`, until `end_turn`.
- Prefer the Tool Runner; write a manual loop when you need full control.
- Return all parallel tool results in one user message, and report failures with `is_error` rather than dropping them.
- Forced `tool_choice` is rejected on Claude Opus 5.5; use `auto`, clear instructions and `strict: true`.
- Use `output_config.format` (or `messages.parse` in Python) whenever you need guaranteed JSON.
- Server tools run on Anthropic's side and report errors inside the response, not as exceptions.
- Treat every tool input as untrusted and keep business validation in your own code.
