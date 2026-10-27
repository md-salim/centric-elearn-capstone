#!/usr/bin/env node
// SessionStart hook for the ponytail plugin. Prints a banner as JSON:
//   additionalContext -> added to the model's context at session start
//   systemMessage     -> shown to the user
// Fails open: any error still prints the first line and exits 0.

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const RULES = 'remember to /plan before coding, always reference the stakeholder brief, never commit secrets.'

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : ''
}

function emit(text) {
  process.stdout.write(
    JSON.stringify({
      systemMessage: text,
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text },
    })
  )
}

function findFeatureFiles(projectDir, identities) {
  let names = []
  try {
    names = fs.readdirSync(projectDir).filter((f) => /^FEATURE-.*\.md$/i.test(f))
  } catch {
    return []
  }
  const wanted = identities.filter(Boolean).map((s) => s.toLowerCase())
  return names
    .filter((name) => {
      let text = ''
      try {
        text = fs.readFileSync(path.join(projectDir, name), 'utf8').slice(0, 2000)
      } catch {
        return false
      }
      const m = text.match(/^Owner:\s*(.+?)\s*$/im)
      return !!m && wanted.includes(m[1].toLowerCase())
    })
    .sort()
}

let branch = '(no git branch)'
let first = `Larchmont Capstone — ${branch} — ${RULES}`
try {
  let input = {}
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}')
  } catch {
    /* no stdin */
  }
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()

  branch = git(projectDir, ['branch', '--show-current']) || '(detached HEAD or no git repo)'
  first = `Larchmont Capstone — ${branch} — ${RULES}`

  const status = git(projectDir, ['status', '--porcelain'])
  const dirty = status ? status.split('\n').length : 0
  const state = dirty ? `${dirty} uncommitted change${dirty === 1 ? '' : 's'}` : 'working tree clean'

  const userName = git(projectDir, ['config', 'user.name'])
  const userEmail = git(projectDir, ['config', 'user.email'])
  const branchOwner = branch.split(/[-/_]/)[0]
  const mine = findFeatureFiles(projectDir, [userName, userEmail.split('@')[0], branchOwner])

  const featureLine = mine.length
    ? `Your FEATURE file${mine.length > 1 ? 's' : ''}: ${mine.slice(0, 3).join(', ')}${mine.length > 3 ? ` (+${mine.length - 3} more)` : ''}`
    : 'No FEATURE file is assigned to you yet. Run /plan <feature> to create one.'

  emit(`${first}\nState: ${state}. ${featureLine}`)
  process.exit(0)
} catch (err) {
  emit(first)
  process.exit(0)
}
