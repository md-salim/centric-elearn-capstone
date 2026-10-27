#!/usr/bin/env node
// PreToolUse(Bash): block `rm -rf` (any flag order/form) and any command touching .env files.
// Exit 2 = block and show stderr to Claude. Any internal error fails open (exit 1).
// Guardrail only: indirection such as `bash -c "$cmd"` or a script file can bypass these checks.

const fs = require('fs')

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}')
  } catch {
    return {}
  }
}

function hasRecursiveForceRm(command) {
  // Split into simple commands, then look at each `rm` invocation.
  const segments = command.split(/&&|\|\||;|\||\n/)
  for (const segment of segments) {
    const tokens = segment.trim().split(/\s+/)
    const at = tokens.findIndex((t) => /^(?:.*\/)?rm$/.test(t))
    if (at === -1) continue
    const flags = tokens.slice(at + 1).filter((t) => t.startsWith('-'))
    const recursive = flags.some((f) => f === '--recursive' || /^-[a-zA-Z]*[rR]/.test(f))
    const force = flags.some((f) => f === '--force' || /^-[a-zA-Z]*f/.test(f))
    if (recursive && force) return true
  }
  return false
}

// `.env` or `.env.local` etc. as a path component; `.env.example|sample|template` are allowed.
const ENV_FILE = /(?:^|[\s/\\'"=<>(])\.env(?!\.(?:example|sample|template)(?:$|[\s'";|&)]))(?:\.[\w.-]+)?(?=$|[\s'";|&)])/

try {
  const input = readInput()
  const command = (input.tool_input && input.tool_input.command) || ''

  if (hasRecursiveForceRm(command)) {
    process.stderr.write('Blocked: `rm -rf` is not allowed in this project. Delete specific files, or ask the user to do it.\n')
    process.exit(2)
  }
  if (ENV_FILE.test(command)) {
    process.stderr.write('Blocked: commands that touch .env files are not allowed (they hold secrets). Use .env.example, or ask the user.\n')
    process.exit(2)
  }
  process.exit(0)
} catch (err) {
  process.stderr.write(`block-dangerous-bash hook error (ignored): ${err.message}\n`)
  process.exit(1)
}
