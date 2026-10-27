#!/usr/bin/env node
// Helper for write-handoff.sh. Reads the Stop hook JSON from stdin, summarises the session transcript
// (JSONL) and writes docs/session-logs/YYYY-MM-DD-auto-<session>.md. Never throws, always exits 0.

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

function pad(n) {
  return String(n).padStart(2, '0')
}

function redact(text) {
  return text
    .replace(/\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)(\s*[=:]\s*)[^\s;,'"]+/gi, '$1$2[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, '[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[REDACTED]')
}

function git(projectDir, args) {
  const r = spawnSync('git', args, { cwd: projectDir, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : ''
}

function readTranscript(file) {
  const result = { prompts: [], files: new Set() }
  if (!file || !fs.existsSync(file)) return result
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const content = entry.message && entry.message.content
    if (entry.type === 'user' && !entry.isMeta) {
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n')
            : ''
      const trimmed = text.trim()
      // Skip slash-command plumbing and injected reminders.
      if (trimmed && !trimmed.startsWith('<') && !trimmed.startsWith('Caveat:')) result.prompts.push(trimmed)
    }
    if (entry.type === 'assistant' && Array.isArray(content)) {
      for (const item of content) {
        if (item && item.type === 'tool_use' && ['Edit', 'Write', 'NotebookEdit'].includes(item.name)) {
          const p = item.input && (item.input.file_path || item.input.notebook_path)
          if (p) result.files.add(String(p).replace(/\\/g, '/'))
        }
      }
    }
  }
  return result
}

try {
  let input = {}
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}')
  } catch {
    /* no or bad stdin: carry on with defaults */
  }
  if (input.stop_hook_active) process.exit(0)

  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
  const normProject = projectDir.replace(/\\/g, '/').replace(/\/$/, '')
  const session = String(input.session_id || 'unknown').replace(/[^A-Za-z0-9-]/g, '').slice(0, 8) || 'unknown'
  const now = new Date()
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

  const { prompts, files } = readTranscript(input.transcript_path)
  // Paths are compared case-insensitively (Windows drive letters differ in case). Files outside the
  // project are counted but not listed, so absolute local paths (and user names) never reach a committed file.
  const lowerProject = normProject.toLowerCase() + '/'
  const inside = [...files].filter((f) => f.toLowerCase().startsWith(lowerProject))
  const outsideCount = files.size - inside.length
  const touched = inside.map((f) => f.slice(lowerProject.length)).sort()

  const branch = git(projectDir, ['branch', '--show-current']) || '(detached or not a git repo)'
  const status = git(projectDir, ['status', '--short'])
  const dirty = status ? status.split('\n').length : 0

  const firstPrompt = prompts.length ? redact(prompts[0]).replace(/\s+/g, ' ').slice(0, 300) : '(not available)'

  const body =
    `# Session handoff (auto): ${date}\n\n` +
    `> Mechanical summary written by the Stop hook. It cannot see decisions or open questions.\n` +
    `> Run \`/handoff\` for the full note (goal, key decisions, open questions, follow-ups).\n\n` +
    `- Session: ${session}\n` +
    `- Branch: ${branch}\n` +
    `- Uncommitted entries in \`git status\`: ${dirty}\n` +
    `- User prompts this session: ${prompts.length}\n\n` +
    `## First prompt (likely goal)\n${firstPrompt}\n\n` +
    `## Files edited or written by Claude this session\n` +
    (touched.length ? touched.map((f) => `- \`${f}\``).join('\n') : '- (none recorded)') +
    (outsideCount ? `\n- (${outsideCount} file${outsideCount === 1 ? '' : 's'} outside the project not listed)` : '') +
    `\n\n## git status --short\n` +
    '```\n' + (status || '(clean)') + '\n```\n'

  const dir = path.join(projectDir, 'docs', 'session-logs')
  const file = path.join(dir, `${date}-auto-${session}.md`)
  // Only rewrite when something changed, so repeated Stop events don't churn git.
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === body) process.exit(0)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, body)
  process.exit(0)
} catch (err) {
  process.stderr.write(`write-handoff error (ignored): ${err.message}\n`)
  process.exit(0)
}
