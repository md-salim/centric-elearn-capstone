#!/usr/bin/env node
// PostToolUse(Edit|Write) on CLAUDE.md: intentionally does nothing, so editing CLAUDE.md can never
// start a hook loop. Reads and discards stdin so the caller never sees a broken pipe.
process.stdin.resume()
process.stdin.on('data', () => {})
process.stdin.on('end', () => process.exit(0))
