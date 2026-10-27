#!/usr/bin/env node
// UserPromptSubmit: append the user's prompt to docs/prompt-journal.md as an [auto] entry.
// The journal is committed, so long prompts are truncated and obvious secrets are redacted.
// Never blocks the prompt: any error exits 1 (non-blocking).

const fs = require('fs')
const path = require('path')

const MAX_CHARS = 1500

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}')
  } catch {
    return {}
  }
}

function redact(text) {
  return text
    .replace(/\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)(\s*[=:]\s*)[^\s;,'"]+/gi, '$1$2[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, '[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[REDACTED]')
}

// The IDE and harness wrap extra context around what the user typed; keep only the typed text.
function stripInjected(text) {
  return text
    .replace(/<(ide_[a-z_]+|system-reminder|local-command-caveat|local-command-stdout|command-name|command-message|command-args)>[\s\S]*?<\/\1>/g, '')
    .trim()
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function timestamp(d) {
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

try {
  const input = readInput()
  const prompt = stripInjected(input.prompt || '')
  if (!prompt) process.exit(0)

  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
  const journal = path.join(projectDir, 'docs', 'prompt-journal.md')
  fs.mkdirSync(path.dirname(journal), { recursive: true })

  if (!fs.existsSync(journal)) {
    fs.writeFileSync(
      journal,
      '# Prompt journal\n\n' +
        'Entries tagged `[auto]` are written by the UserPromptSubmit hook (timestamp + prompt only).\n' +
        'Entries tagged `[manual]` are written by the `prompt-journal` skill (prompt, tools used, outcome).\n' +
        'Secrets are redacted and long prompts are truncated.\n\n'
    )
  }

  let text = redact(prompt)
  if (text.length > MAX_CHARS) text = `${text.slice(0, MAX_CHARS)} ... [truncated]`
  const quoted = text.split(/\r?\n/).map((line) => `> ${line}`).join('\n')

  fs.appendFileSync(journal, `## [auto] ${timestamp(new Date())}\n\n${quoted}\n\n`)
  process.exit(0)
} catch (err) {
  process.stderr.write(`log-prompt hook error (ignored): ${err.message}\n`)
  process.exit(1)
}
