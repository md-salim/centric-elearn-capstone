#!/usr/bin/env node
// PostToolUse(Edit|Write): after a .cs file under backend/Larchmont.Api is edited, build the solution.
// On build failure print the error lines to stderr and exit 2 so Claude sees them (the edit is kept).
// Any internal problem fails open (exit 1 / 0).

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}')
  } catch {
    return {}
  }
}

try {
  const input = readInput()
  const filePath = ((input.tool_input && input.tool_input.file_path) || '').replace(/\\/g, '/')

  if (path.basename(filePath).toLowerCase() === 'claude.md') process.exit(0)
  if (!/(^|\/)backend\/Larchmont\.Api\/.*\.cs$/i.test(filePath)) process.exit(0)

  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
  const build = spawnSync('dotnet', ['build', 'backend/Larchmont.sln', '--nologo'], {
    cwd: projectDir,
    encoding: 'utf8',
    timeout: 170000,
    maxBuffer: 20 * 1024 * 1024,
  })

  if (build.error) {
    process.stderr.write(`Could not run dotnet build: ${build.error.message}\n`)
    process.exit(1)
  }
  if (build.status === 0) process.exit(0)

  const lines = `${build.stdout || ''}\n${build.stderr || ''}`
    .split(/\r?\n/)
    .filter((line) => /\berror\b/i.test(line) && !/^\s*0 Error/i.test(line))
  const unique = [...new Set(lines.map((l) => l.trim()))].slice(0, 15)
  process.stderr.write(
    `WARNING: dotnet build failed after editing ${filePath}. Fix before continuing:\n${unique.join('\n') || '(no error lines captured; run dotnet build to see output)'}\n`
  )
  process.exit(2)
} catch (err) {
  process.stderr.write(`build-on-cs-edit hook error (ignored): ${err.message}\n`)
  process.exit(1)
}
