# Chapter 12: Working Effectively — Team Workflows

Knowing the features of Claude Code is not the same as using it well. The teams who get the most out of it share a handful of habits: they make Claude explore before it edits, they agree a plan before code is written, they insist on evidence, they keep context clean, and they leave a trail the next person can follow.

This chapter turns those habits into concrete workflows, using the conventions already built into this repository. It ends with a full worked example: fixing bug LH-56, where the occupancy report overstated occupancy.

## 12.1 Explore, plan, code, commit

The single most useful workflow is four steps, done in order, with a pause for you between each.

| Step | What Claude does | What you do |
|---|---|---|
| Explore | Reads the relevant files, tests and documents. Writes nothing. | Point it at the right area; correct misunderstandings early |
| Plan | Proposes the change, the tests and the risks | Approve, amend or reject the plan |
| Code | Implements the agreed plan, runs the build and tests | Watch the diff; stop it if it drifts |
| Commit | Writes a clear commit message, opens a pull request if asked | Review the final diff before it leaves your machine |

Why this order matters: Claude is fast and confident. Without an exploration step it may solve the problem it imagines rather than the one in the code. Without a plan step, you discover disagreements only when you read a large diff, which is the most expensive time to discover them.

### Exploring

Ask questions before asking for changes:

```text
Read backend/Larchmont.Api/Services/ReportService.cs and the occupancy tests in
backend/Larchmont.Tests. Explain how room nights are counted. Do not change anything.
```

For wider questions, ask Claude to use a subagent (the built-in Explore agent, or this repository's `db-analyst`) so the file-reading stays out of your main conversation and only the conclusion comes back.

### Planning

Plan mode (Shift+Tab to cycle modes, or `--permission-mode plan`) lets Claude read and reason but not edit. This repository also has a `/plan` command that writes a `FEATURE-<name>.md` file and no code, and a `planner` agent that splits a feature into backend, frontend and test work.

A good plan names the files to change, the acceptance criteria, the tests that prove each criterion, and what is out of scope. Writing the plan to a file has a second benefit: it survives `/clear` and can be handed to another person or another session.

### Coding

Once the plan is agreed, the instruction can be short: "Implement the plan in FEATURE-x.md." The repository's `/implement` command dispatches the `backend`, `frontend` and `test-writer` agents and then the `reviewer`. The `PostToolUse` hook `build-on-cs-edit.js` builds the backend after every C# edit, so compiler errors surface immediately rather than at the end.

### Committing

Ask Claude to write the commit message and summarise what changed. Read the diff yourself before you commit. Claude Code only commits or pushes when asked, and you should keep it that way for anything that leaves your machine.

> TIP: When a task is small and obvious, such as a typo or a one-line fix, skip the formal plan. The four steps scale down: "look at X, tell me the fix, then make it" is still explore, plan, code.

## 12.2 Test-driven work with Claude

Claude is particularly effective when the goal is expressed as a test that must pass. A failing test is an unambiguous target, and a passing test is evidence rather than a claim.

This repository's testing conventions (`.claude/rules/testing-conventions.md`) set three rules that make this work well:

- New tests are named after the acceptance criterion: `AC_NN_Description`, for example `AC_04_CannotMarkReadyWithoutInspection`. One behaviour per test.
- "A bug-fix test must fail on the original code. Run it before the fix and keep that output."
- Tests must not depend on order or shared state; each `ApiFactory` gets its own database.

The resulting loop:

1. Write the test for the acceptance criterion. Run it. Confirm it fails, and that it fails for the right reason (an assertion, not a compile error or a missing seed).
2. Commit the failing test, or at least save the output, so the failure is on record.
3. Implement the smallest change that makes the test pass.
4. Run the whole suite, not just the new test.
5. Refactor if needed, with the suite green after each step.

The `test-writer` agent in this repository is built around exactly this: it "writes xUnit tests named AC_NN_Description for acceptance criteria and bug fixes, and proves each new test fails against the broken or unimplemented code first".

> WARNING: Watch for a model "making the test pass" by weakening the test, special-casing the test data, or catching the exception the test expects. Tell Claude explicitly that the tests are the specification and must not be changed to fit the code, and read test diffs as carefully as production diffs.

## 12.3 Reviewing diffs

Every change deserves a review, and Claude can help with that too, provided the review is independent of the code it is checking.

Tools available in this repository:

- **The `reviewer` agent** reviews a diff against `docs/review-checklist.md` and writes findings to `docs/review-report.md`. It reports only; it does not fix code.
- **The `/code-review` command** reviews the current diff for correctness bugs at a chosen effort level, and can post findings as PR comments or apply fixes.
- **The `/security-review` command** reviews pending changes on the branch for security issues.

The checklist is worth reading in full, because it encodes what this team has decided matters. A few items that catch real problems:

- "Date and night counting is right at the edges (check-in day, check-out day, same-day turnover)."
- "List endpoints run a fixed number of queries however many rows they return."
- "Two people changing the same record at the same moment cannot both succeed silently."
- "No secret, key or password is committed in any file, config or compose file."
- "Each test fails if the behaviour it names is broken (try breaking the code to check)."

> TIP: A review done in the same conversation that wrote the code tends to agree with itself. Run the reviewer as a subagent or in a fresh session so it sees the diff and the checklist, not the reasoning that produced the change.

## 12.4 Managing context

Claude's context window is large but not free. Long conversations accumulate stale file contents, abandoned approaches and tool output that no longer matters. Quality drops and cost rises. Managing context is a core skill.

| Tool | What it does | When to use it |
|---|---|---|
| `/clear` | Starts a fresh conversation in the same session | Switching to an unrelated task |
| `/compact` | Summarises the conversation so far and continues from the summary | A long task that is going well but filling up |
| Subagents | Do focused work in their own context and return a summary | Broad searches, reviews, analysis |
| Files on disk | Plans, specs and handoff notes persist outside the conversation | Anything you want to survive `/clear` or a new session |
| `CLAUDE.md` and rules | Loaded into every session | Conventions that should always apply |

You can pass guidance to `/compact`, for example `/compact keep the decisions about the occupancy fix and the test names`, so the summary keeps what matters.

### Handoff notes

When a session ends or a task changes hands, a handoff note lets the next person, or the next session, continue without re-reading the transcript. This repository automates that in two layers:

- A `Stop` hook runs `.claude/skills/session-handoff/write-handoff.sh`, which writes a short mechanical note named `YYYY-MM-DD-auto-<session>.md` listing the branch, files and git status.
- The `session-handoff` skill (run with `/handoff`) writes the full note to `docs/session-logs/YYYY-MM-DD-<slug>.md`, with sections for Goal, Key decisions, Files touched, Open questions and Follow-ups.

The skill's rules are a good model for any summary written by Claude: "Be accurate over complete. If something was not tested or verified, say so under Open questions." It also confirms files touched with `git status --short` and `git diff --stat` rather than trusting memory, because "Do not claim a file was changed if git shows it was not."

To pick up the work, start a new session and say: "Read docs/session-logs/2026-10-27-claude-setup-agents-hooks-skills.md and continue from the follow-ups."

## 12.5 Parallel work with git worktrees

Sometimes you want two Claude sessions working at once: one fixing a bug while another builds a feature. Running both in the same working directory is a recipe for collisions. Git worktrees solve this by giving each task its own checkout of the same repository.

```bash
# Create a second working copy on a new branch
git worktree add ../larchmont-lh56 -b fix/lh-56

# Start Claude in it, in a separate terminal
cd ../larchmont-lh56 && claude

# When finished and merged, remove it
git worktree remove ../larchmont-lh56
```

Each worktree has its own files and branch but shares history, so commits from either are immediately visible to the other. Subagents can also be launched in an isolated worktree, which is useful when several agents edit code in parallel.

Rules of thumb for parallel sessions:

- Give each session a clearly separate area of the code. Two agents editing the same file in different worktrees still produce a merge conflict later.
- Remember that shared resources are still shared: both worktrees talk to the same MySQL database on port 3306 unless you configure otherwise.
- Keep the number of parallel sessions small enough that you can actually review what each produces.

## 12.6 The prompt journal

This repository keeps `docs/prompt-journal.md`, a running record of prompts and outcomes. Entries tagged `[auto]` are written by the `UserPromptSubmit` hook (`log-prompt.js`) with a timestamp and the prompt text; entries tagged `[manual]` are written by the `prompt-journal` skill and add the tools used and the outcome. Secrets are redacted and long prompts truncated.

A journal pays for itself quickly:

- It shows which prompts produced good results, so you can reuse them or turn them into commands and skills.
- It records surprises and failures, which are the best material for improving `CLAUDE.md` and rules.
- It gives reviewers and assessors an honest record of how AI assistance was used.

The `/reflect` command builds on this: it scans the conversation for repeated manual steps and proposes new skills, writing its suggestions to `docs/reflection-<date>.md`.

## 12.7 Verifying claims

The most important habit of all: treat Claude's statements about the code as hypotheses until there is evidence. Claude will often be right, but it reports mistakes in the same confident tone as successes.

This repository's `CLAUDE.md` makes one category of claim explicit:

> WARNING: "The in-memory tests cannot prove performance, indexes, SQL translation or concurrency. Those claims need a test against real MySQL 8.4 or the EF Core SQL log."

The EF Core InMemory provider does not run SQL, enforce constraints or behave like a real database under concurrent access. A green in-memory test says the C# logic is right; it says nothing about whether the LINQ query translates to sensible SQL, whether an index is used, or whether two simultaneous updates are handled. The testing conventions require that you "say which evidence you used. Do not report an in-memory pass as proof."

Practical verification habits:

- Ask Claude to show its evidence: the test output, the SQL log, the command it ran.
- For claims about behaviour, ask for a test that would fail if the claim were false.
- For claims about files, check with `git diff` or by opening the file.
- For performance or concurrency, insist on a run against real MySQL (this repository has tests such as `MySqlConcurrencyTests.AC_20_ConcurrentBookingAssignmentReturns409_RealMySql` for exactly this reason).
- End each task with `dotnet test`, and `npm run build` for frontend changes, as `CLAUDE.md` requires before work is called done.

## 12.8 Common failure modes and how to recover

| Symptom | Likely cause | Recovery |
|---|---|---|
| Claude edits files you did not mean it to touch | Vague scope | Rewind, then restate the scope with explicit file paths |
| The same fix is tried repeatedly | Missing information, often an error message or a failing test it cannot see | Stop it, give it the exact error, or ask it to explain before retrying |
| The answer contradicts the code | Stale context or a guess | Ask it to re-read the file and quote the relevant lines |
| Quality drops late in a long session | Context full of stale material | `/compact` with guidance, or write a handoff and `/clear` |
| Tests pass but the bug remains | Test does not exercise the real path, or was weakened | Break the code deliberately and confirm the test fails |
| Conventions ignored | Rules not loaded or too vague | Move the rule into `CLAUDE.md` or `.claude/rules/`, and make it specific |

### Interrupting and rewinding

- Press **Esc** to interrupt Claude mid-task. The conversation is preserved and you can redirect it.
- Press **Esc twice**, or use `/rewind`, to go back to an earlier point. Claude Code keeps checkpoints of file edits it makes, so you can restore the code, the conversation, or both, to a previous message.

> NOTE: Checkpoints cover edits made through Claude's file-editing tools. Changes made by shell commands (for example a script that rewrites files, or a database migration) are not tracked by checkpoints and cannot be undone that way. Git remains your real safety net: commit or stash before large changes.

## 12.9 Worked example: fixing LH-56 end to end

Bug LH-56, raised by Sofia Lindqvist, Director of Rooms, reports that the occupancy report overstates occupancy. For Larchmont Edinburgh on Friday 2 October 2026, the report says 9 rooms sold (45%), but the night audit says 5 (25%). The ticket gives a decisive clue: "Four guests checked out of Edinburgh on the morning of 2 October. Their rooms were empty that night and were not sold to anyone." The expected results are precise: `roomNightsSold` = 5 and `occupancyPct` = 25 for the single day, and 45 and 32.1 for 1 to 7 October.

### Step 1: Explore

```text
Read docs/bug-LH-56.md. Then find where the occupancy report is calculated and explain
how a booking is counted against a given night. Do not change any code.
```

Claude follows the request flow from the controller to `ReportService.GetOccupancyAsync`, and from there to `BookingRepository.ListOverlappingAsync`. The service loops over each day in the range and counts the bookings that occupy it. In the original code the count was:

```csharp
var sold = bookings.Count(b => b.CheckIn <= day && day <= b.CheckOut);
```

The `<=` on the check-out side counts the check-out date as an occupied night. A guest who checks in on 1 October and out on 2 October has stayed one night (the night of 1 October), but this expression counts them on both days. The four check-outs on 2 October explain exactly the gap between 9 and 5.

### Step 2: Plan

The plan Claude proposes should be short:

- Acceptance criterion: a booking occupies the nights from check-in up to, but not including, check-out.
- Tests: one for the single-day case from the ticket and one for the weekly case, both named `AC_56_...`, written first and shown to fail.
- Fix: change the comparison in `ReportService` to exclude the check-out date.
- Check whether the repository query also needs changing (it should still fetch bookings that overlap the range; the service decides which nights count).
- Out of scope: other reports. Note that the review checklist asks for night counting to be right "at the edges", so the reviewer should check arrivals and revenue too.

### Step 3: Write the failing tests

The `test-writer` agent adds unit tests to `backend/Larchmont.Tests/UnitTests.cs`. The single-day test reproduces the ticket: four bookings that check out on 2 October and five that stay over, in a 20-room hotel.

```csharp
[Fact]
public async Task AC_56_CheckoutDateIsNotCountedAsAnOccupiedNight()
{
    var date = new DateOnly(2026, 10, 2);
    _hotels.Setup(h => h.GetAsync(1)).ReturnsAsync(new Hotel { Id = 1 });
    _bookings.Setup(b => b.ListOverlappingAsync(1, date, date)).ReturnsAsync(
        Enumerable.Range(1, 4)
            .Select(id => new Booking { Id = id, HotelId = 1,
                CheckIn = date.AddDays(-1), CheckOut = date })
            .Concat(Enumerable.Range(5, 5).Select(id => new Booking { Id = id, HotelId = 1,
                CheckIn = date.AddDays(-1), CheckOut = date.AddDays(1) }))
            .ToList());
    _rooms.Setup(r => r.CountForHotelAsync(1)).ReturnsAsync(20);

    var report = await Sut().GetOccupancyAsync(1, date, date);

    Assert.Equal(5, report.RoomNightsSold);
    Assert.Equal(25m, report.OccupancyPct);
    Assert.Equal(5, Assert.Single(report.Days).RoomsSold);
}
```

A second test, `AC_56_WeeklyOccupancyExcludesCheckoutDates`, covers 1 to 7 October. Both are run against the unfixed code and fail: the single-day test reports 9 rooms sold, not 5. That output is kept, as the testing conventions require.

### Step 4: Fix

The fix is one character:

```csharp
var sold = bookings.Count(b => b.CheckIn <= day && day < b.CheckOut);
```

The build hook compiles the project after the edit. `dotnet test backend/Larchmont.sln` then shows both new tests passing and the rest of the suite still green.

### Step 5: Verify the evidence

Ask what the tests prove and what they do not. These are unit tests with mocked repositories: they prove the counting rule in the service. They do not prove that `ListOverlappingAsync` returns the right bookings from MySQL, nor that the end-to-end numbers for the seeded week now match the night audit. To close that gap, start the API against the seeded database and repeat the ticket's own reproduction steps:

```bash
curl "http://localhost:5080/api/reports/occupancy?hotelId=1&from=2026-10-02&to=2026-10-02"
curl "http://localhost:5080/api/reports/occupancy?hotelId=1&from=2026-10-01&to=2026-10-07"
```

The expected values are 5 and 25 for the day, and 45 and 32.1 for the week. Recording that these figures were checked against real data, and how, is part of the fix.

### Step 6: Review

Run the `reviewer` agent on the diff. Against the checklist it should pass "every criterion has a test" and "a new test fails on the old code", and it should look at the edge-case item about check-in day, check-out day and same-day turnover. A good reviewer might also ask whether a same-day booking (check-in and check-out on the same date) is possible and how it should count; under the new rule it counts as zero nights, which is a business question worth confirming with Sofia rather than settling in code.

### Step 7: Commit and hand off

Ask Claude for a commit message that references the ticket, for example "Fix LH-56: exclude check-out date from occupancy night count". Then run `/handoff` so the session log records the decision, the files touched, the evidence used and any open question, such as the same-day booking rule.

> NOTE: The whole fix was one character, but the workflow around it is what makes it trustworthy: a reproduction from the ticket, tests that failed first, a check against real data, an independent review and a written record.

## Exercises

> EXERCISE: Take a small open item from this repository and run it through explore, plan, code, commit. Save the plan to a file before any code is written, and note one thing the exploration step changed about your plan.

> EXERCISE: Revert the LH-56 fix locally (change `<` back to `<=`), run `dotnet test`, and confirm both `AC_56_` tests fail. Restore the fix and confirm they pass. Explain why this matters.

> EXERCISE: Run the `reviewer` agent on your most recent change and compare its report with your own reading of `docs/review-checklist.md`. Did it catch anything you missed, or miss anything you caught?

> EXERCISE: Work on a task until the conversation is long, then use `/compact` with guidance about what to keep. Afterwards, ask Claude to state the key decisions and check them against what you remember.

> EXERCISE: Create a git worktree for a second task, run a separate Claude session in it, and merge both branches. Note any shared resources (such as the database) that caused interference.

> EXERCISE: Read three entries in `docs/prompt-journal.md` and turn the most reusable prompt into a slash command under `.claude/commands/`.

## Key takeaways

- Explore, plan, code, commit: pause between each step, and write plans to files so they survive context resets.
- Express goals as tests. Use the `AC_NN_Description` convention, and prove every bug-fix test fails on the original code.
- Review with fresh eyes: the `reviewer` agent, `/code-review` and `/security-review`, all against an explicit checklist.
- Manage context deliberately with `/clear`, `/compact`, subagents and handoff notes in `docs/session-logs`.
- Use git worktrees to run parallel sessions without collisions, and keep shared resources in mind.
- Keep a prompt journal and mine it for reusable commands, skills and rules.
- Treat claims as hypotheses. In-memory tests cannot prove SQL, indexes, performance or concurrency; say which evidence you used.
- Interrupt with Esc, rewind with Esc twice or `/rewind`, and remember checkpoints do not cover shell side effects; git is your real safety net.
