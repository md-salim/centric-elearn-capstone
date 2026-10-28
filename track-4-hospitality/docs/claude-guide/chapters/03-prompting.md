# Chapter 3: Prompting Well

A prompt is everything you give Claude to work with: the instruction, the background, the examples, the documents and the format you want back. Prompting is not about magic phrases. It is about communicating a task clearly to a very capable colleague who knows a great deal in general but nothing about your project, your team or what you were thinking a minute ago. This chapter covers the principles that apply everywhere, then shows how they apply to coding tasks and to Claude Code in this repository.

## The brilliant new colleague test

A useful way to judge a prompt is to imagine handing it to a brilliant engineer who joined the team this morning. They are fast and knowledgeable, but they have not seen the codebase, do not know the conventions, and cannot read your mind. Ask yourself:

- Would they know what "done" looks like?
- Would they know which files or parts of the system are involved?
- Would they know the constraints, such as "do not edit applied migrations" or "keep the change small"?
- Would they know why the task matters, so they can make sensible judgement calls?

If the answer to any of these is no, Claude is likely to fill the gap with a reasonable guess, and a reasonable guess is not always the one you wanted.

## Be clear and specific

Vague prompts produce generic results. Specific prompts produce useful ones. Compare:

| Vague | Specific |
|---|---|
| "Improve the bookings code." | "The `POST /api/bookings` endpoint allows a booking whose check-out date is before its check-in date. Add validation that rejects this with a 400 and a clear message, following the existing FluentValidation pattern." |
| "Write some tests." | "Write xUnit tests for `BookingValidator` covering: check-out before check-in, zero nights, more guests than the room type allows. Name them `AC_NN_Description` as the testing conventions require." |
| "Summarise this." | "Summarise this stakeholder brief in five bullet points for a developer who needs to know which features are in scope for the first release." |

Specificity is not the same as length. A specific prompt states the goal, the scope and the success criteria. It does not need to dictate every step.

### State the goal and the definition of done

Tell Claude what outcome you want and how you will judge it. "Add the endpoint and make sure `dotnet test` passes" gives Claude a clear finishing line and a way to check itself. Without it, Claude has to guess when to stop.

### Say what you want, not only what to avoid

"Do not use long paragraphs" is weaker than "Use short paragraphs of two or three sentences". Positive instructions give Claude a target; negative instructions only remove options.

## Provide context

Claude can only use what is in its context. The most common cause of a disappointing answer is missing context that was obvious to the person asking.

Useful context includes:

- **Purpose.** Who will use the output and why. "This summary is for the hotel general managers, who are not technical" changes the vocabulary and level of detail.
- **Background.** Relevant decisions, constraints and history. "We chose DbUp over EF migrations so that DBAs can review plain SQL" explains why Claude should not suggest `dotnet ef migrations add`.
- **Material.** The actual documents, files, error messages or logs. Paste the full stack trace rather than describing it.
- **Reasons for rules.** "Never commit connection strings, because this repository is shared with an external training provider" is better than "Never commit connection strings".

> TIP: Explaining the reason behind an instruction lets Claude generalise. If you say "keep responses short because they are read on a phone at the front desk", Claude will also avoid wide tables, which you never mentioned.

## Use examples

Examples are one of the most powerful prompting tools. A couple of well-chosen examples communicate format, tone and level of detail more precisely than a paragraph of description.

```text
Classify each guest review as POSITIVE, NEGATIVE or MIXED, and give the main topic.

Examples:
Review: "Lovely room, but breakfast was cold and the staff seemed rushed."
Answer: MIXED | breakfast

Review: "Check-in took 40 minutes and nobody apologised."
Answer: NEGATIVE | check-in

Now classify:
Review: "Spotless, quiet and the concierge booked us a brilliant restaurant."
```

Guidelines for examples:

- **Make them representative.** Cover the typical cases and at least one tricky one.
- **Vary them.** If every example has the same structure, Claude may copy incidental features, such as always choosing the first category.
- **Keep them consistent with your instructions.** If the instruction says "one word" but an example has three, Claude will follow the example.

In coding work, the best example is often existing code. "Follow the pattern in `HotelsController` and `HotelService`" is an example by reference, and it is usually better than describing the pattern in prose.

## Structure prompts with XML tags

When a prompt mixes instructions, documents, examples and data, it helps to separate them clearly. Claude responds well to XML-style tags as delimiters. There is nothing special about particular tag names; use descriptive ones and be consistent.

```text
<context>
Larchmont Hotels runs six hotels. Bookings are imported nightly from a channel
manager as CSV. The importer must reject rows with unknown room type codes.
</context>

<csv_sample>
booking_ref,hotel_code,room_type,check_in,check_out,guests
CM-1001,LHLON,DBL,2026-11-02,2026-11-05,2
CM-1002,LHLON,PENTHOUSE,2026-11-02,2026-11-03,4
</csv_sample>

<task>
List every validation rule the importer should apply to this format. For each
rule, say whether it should reject the row or the whole file.
</task>

<output_format>
A table with columns: Rule, Scope (row or file), Reason.
</output_format>
```

Tags help in three ways: they stop Claude confusing your data with your instructions, they make long prompts easier for humans to maintain, and they let you refer to parts of the prompt ("using the rules in `<policy>`...").

> NOTE: Put long documents near the top of the prompt and your question or task near the end. With large inputs, this ordering tends to produce better answers.

## Roles and system prompts

Giving Claude a role in the system prompt focuses its behaviour and vocabulary. "You are a senior database engineer reviewing MySQL schema changes for a hotel booking system" yields a different review from "You are a helpful assistant".

A good system prompt for an application usually covers:

1. Who Claude is acting as, and for whom.
2. What the application is for.
3. Key rules and the reasons for them.
4. How to handle uncertainty and out-of-scope requests.
5. Output format and tone.

```text
You are the internal operations assistant for Larchmont Hotels. Your users are
hotel duty managers. Answer questions about occupancy, bookings and staffing
using only the data returned by your tools. If the tools do not return the
information needed, say so plainly rather than estimating, because managers
use your answers to make staffing decisions. Write in British English, use
short paragraphs, and show figures with their units.
```

In Claude Code, the equivalent of a system prompt is spread across `CLAUDE.md`, the rule files it references, any output style, and, for subagents, the body of the agent definition file. The same principles apply: clear purpose, rules with reasons, and a definition of done.

## Ask for a plan first

For anything non-trivial, asking Claude to plan before acting catches misunderstandings while they are cheap to fix.

- In the API, you can ask for a plan in one request, review it, and then ask for the implementation in the next.
- In Claude Code, use **plan mode** (cycle to it with Shift+Tab, or start a session with the plan permission mode). Claude explores the code and proposes a plan without editing anything; you approve it or ask for changes.
- This repository also has a `/plan` command that writes a `FEATURE-<name>.md` plan file without writing any code, and an `/implement` command that takes such a file and dispatches the specialist agents.

A good planning prompt asks Claude to identify the files involved, the order of changes, the risks and how the change will be tested. Reviewing a ten-line plan takes a minute; reviewing a three-hundred-line diff built on a misunderstanding takes much longer.

> TIP: When you review a plan, look first for wrong assumptions about scope. "I will add a new `RatesController`" when one already exists is a sign Claude has not explored enough; ask it to look again before proceeding.

## Verification and self-checking

You can prompt Claude to check its own work, and you should. Some patterns that work well:

- **Ask for verification steps.** "After implementing, run `dotnet test backend/Larchmont.sln` and show me the summary line."
- **Chain of verification.** For factual or analytical output: draft an answer, list the claims it makes, check each claim against the source, then revise. You can do this in one prompt ("Before answering, check each figure against the CSV") or across several.
- **Ask for evidence.** "Quote the line in the migration that creates the index" forces grounding.
- **Invite uncertainty.** "If you are not sure whether EF Core translates this query to SQL, say so and suggest how to check" reduces confident guessing.
- **Separate the reviewer.** A fresh context reviewing a change is less anchored than the context that wrote it. This repository's `reviewer` agent exists for this reason: it reviews the diff against `docs/review-checklist.md` and writes findings, without fixing code.

## Prompting for code tasks

Code tasks benefit from a few extra habits.

### Point to the right places

Name the files, classes or endpoints involved when you know them. When you do not, ask Claude to find them first: "Find where booking overlap is checked and explain how it works before changing anything."

### Reference existing patterns

Consistency matters more than cleverness in a team codebase. "Follow the same structure as the existing `GuestsController`, `GuestService` and `GuestRepository`" produces code that reviewers recognise.

### Constrain the scope

Claude is capable of large changes, which is not always what you want. Say "keep the change small", "do not refactor unrelated code" or "only touch files under `backend/Larchmont.Api/Validators`" when that matters. The project `CLAUDE.md` already says "Keep changes small", but restating it for a sensitive task does no harm.

### Give precise failure information

Paste the actual error, the failing test name and output, and the command you ran. "The test fails" gives Claude nothing to work with; the stack trace often gives it the answer.

### Specify how to test

Say which tests to write and how to run them, or point to the conventions. In this repository, `.claude/rules/testing-conventions.md` and the `test-writer` agent define how tests are named and that a new test must be shown to fail against the broken code first.

## Prompting Claude Code in this repository

Claude Code already knows a lot about this project before you type anything, because it loads the track `CLAUDE.md` (stack, commands, layout, rules) and can read the referenced rule files. Good prompts build on that rather than repeating it, and add what only you know: the specific goal, the ticket, the edge cases and the definition of done.

| Poor prompt | Better prompt | Why it is better |
|---|---|---|
| "Add an endpoint for room availability." | "Add `GET /api/hotels/{hotelId}/availability?from=&to=` that returns room types with the count of free rooms for the date range. Follow Controller -> Service -> Repository -> DbContext, add a FluentValidation validator for the query (from before to, range at most 31 days), and add API tests in `ApiTests.cs`. Run `dotnet test` when done." | States the contract, the layering rule, validation rules, test location and the definition of done |
| "Fix the bug in bookings." | "Bug LH-56 is described in `docs/bug-LH-56.md`. First write a failing test that reproduces it, show me it failing, then fix it with the smallest change and show the test passing." | Points to the source of truth and enforces test-first verification |
| "Add a column for loyalty tier." | "Guests need a `LoyaltyTier` (None, Silver, Gold). Add a new DbUp migration with the next `V00N__` number rather than editing an existing one, update the entity, DTOs, mapper and validator, and update the guest form in the frontend. Run `dotnet test` and `npm run build`." | Respects the migration rule and lists every layer touched |
| "Make the occupancy report faster." | "The occupancy report is slow for a 90-day range. Use the db-analyst agent to look at the query and indexes and write findings to `docs/db-analysis.md`. Do not change code yet. Remember the in-memory tests cannot prove performance, so any claim needs the EF Core SQL log or a test against MySQL 8.4." | Separates analysis from change and respects the project's evidence rule |
| "Review my code." | "Use the reviewer agent to review the current diff against `docs/review-checklist.md` and write the report to `docs/review-report.md`." | Uses the team's checklist and agent, and produces a durable artefact |

Some further tips for Claude Code:

- **Mention files with @.** Typing `@` followed by a path adds that file to the context directly, which saves Claude a search.
- **Use the specialist agents.** "Use the backend agent for the API change and the frontend agent for the form" lets each work with a focused brief.
- **Interrupt early.** If Claude heads in the wrong direction, press Escape and redirect it. Correcting course after two tool calls is cheaper than after twenty.
- **Clear between tasks.** Run `/clear` when you switch to unrelated work so that old context does not leak into the new task.
- **Capture lessons.** When you find yourself repeating the same correction, add it to `CLAUDE.md` or a rule file so that every future session benefits.

## Anti-patterns

Some habits that worked with older models are counter-productive with current ones.

### Over-prescriptive prompts

Older models often needed step-by-step instructions, capital-letter warnings and repeated emphasis. Current models are much better at following instructions and at planning their own approach. Prompts full of "YOU MUST ALWAYS" and "NEVER EVER" tend to make modern models over-apply rules, become rigid in situations the rule was never meant for, or produce stilted output. State the rule once, calmly, with its reason.

### Micromanaging the method

Dictating every step ("first open file A, then search for B, then...") prevents Claude from finding a better route and often reduces quality on capable models. Describe the goal, the constraints and the definition of done, and let Claude choose the steps. Reserve step-by-step instructions for procedures that genuinely must happen in a fixed order, such as a release checklist.

### Stale tricks

- **Assistant prefill** (starting Claude's reply for it) is no longer supported on current models. Use structured outputs or clear format instructions.
- **Fixed thinking budgets** are replaced by adaptive thinking and effort.
- **Asking the model to "think step by step" in visible output** is usually unnecessary now that models think internally; it can make answers longer without making them better.

### Contradictory instructions

Long-lived prompts and `CLAUDE.md` files accumulate rules over time, and some end up contradicting each other ("be concise" in one place, "explain your reasoning in detail" in another). Claude will try to satisfy both and satisfy neither. Review and prune your instructions periodically.

### Kitchen-sink context

Pasting every file you can think of dilutes the signal. Provide what is relevant and let Claude Code search for the rest.

> WARNING: Never paste secrets such as passwords, API keys or production connection strings into a prompt. The project rules forbid committing them, and the same care applies to anything you send to any external service.

## Iterating on prompts

Prompting is empirical. Treat a prompt that matters, such as a system prompt for an application feature or a command used by the whole team, like code.

1. **Define success.** Write down what a good output looks like, ideally with a few concrete test inputs.
2. **Start simple.** Write the clearest prompt you can and try it on the test inputs.
3. **Look at failures.** Read the outputs that went wrong and ask what Claude was missing: context, an example, a constraint or a reason.
4. **Change one thing at a time.** Otherwise you cannot tell which change helped.
5. **Keep a record.** This repository has a `prompt-journal` skill that appends entries (prompt, tools used, outcome) to `docs/prompt-journal.md`; use it for notable successes and failures.
6. **Re-test after model changes.** A prompt tuned for one model may be too prescriptive or too loose for the next.

For application prompts at scale, build a small evaluation set and measure changes against it rather than relying on impressions. Part 5 returns to this.

## Exercises

> EXERCISE: Take the poor prompt "Add an endpoint for staff rotas" and rewrite it using the patterns in this chapter. Include the contract, the layering rule, validation, tests and the definition of done.

> EXERCISE: Write an XML-structured prompt that asks Claude to review `docs/sample-channel-export.csv` against the importer's expected format and list every problem row. Run it in Claude Code and judge the result.

> EXERCISE: Use plan mode to ask Claude to plan adding a cancellation fee to bookings. Review the plan and note any wrong assumptions before letting it implement anything.

> EXERCISE: Find a rule in the track `CLAUDE.md` or `.claude/rules/` that does not state its reason. Draft a version that includes the reason and discuss with your team whether it reads better.

> EXERCISE: Write a system prompt for a front-desk assistant that answers guest questions about hotel facilities. Test it with five questions, including one it should decline, and iterate twice.

## Key takeaways

- Write prompts for a brilliant colleague who knows nothing about your project: goal, context, constraints and definition of done.
- Specific beats vague; positive instructions beat prohibitions; reasons beat bare rules.
- Examples, including existing code referenced by name, communicate format and style better than description.
- Use XML-style tags to separate instructions, documents and data in complex prompts.
- Plan before implementing on anything non-trivial; plan mode and the repo's `/plan` command make this easy.
- Build verification into the prompt: run tests, quote sources, allow "I don't know".
- In Claude Code, build on what `CLAUDE.md` already provides, use `@` file mentions and specialist agents, interrupt early and clear between tasks.
- Avoid over-prescriptive, shouty or micromanaging prompts with modern models, and drop stale tricks such as prefill.
- Treat important prompts like code: test, change one thing at a time, record results and re-test on new models.
