#!/usr/bin/env bash
# Creates or re-keys the mcp_readonly MySQL user (see 03-create-mcp-user.sql).
#
# Required:  MCP_DB_PASSWORD   password for mcp_readonly (never put it on a command line)
# Optional:  MCP_ADMIN_USER    admin account (default root)
#            MCP_DB_HOST       default 127.0.0.1
#            MCP_DB_PORT       default 3306
#            MYSQL_PWD         admin password, read by the mysql client itself
#                              (or use an option file such as ~/.my.cnf; stdin is not a
#                              terminal here, so mysql cannot prompt)
#
# The password is sent to mysql on stdin only, so it is not visible in argv or `ps`.
set -euo pipefail

if [ -z "${MCP_DB_PASSWORD:-}" ]; then
  echo "ERROR: MCP_DB_PASSWORD is not set or is empty. Nothing was created." >&2
  exit 1
fi

if ! command -v mysql >/dev/null 2>&1; then
  echo "ERROR: the mysql client was not found on PATH." >&2
  exit 1
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sql_file="$here/03-create-mcp-user.sql"
[ -r "$sql_file" ] || { echo "ERROR: cannot read $sql_file" >&2; exit 1; }

# Escape for a single-quoted MySQL string literal: backslash first, then single quote.
pw="$MCP_DB_PASSWORD"
pw="${pw//\\/\\\\}"
pw="${pw//\'/\\\'}"

{
  printf "SET @mcp_pw := '%s';\n" "$pw"
  cat "$sql_file"
} | mysql \
      --protocol=TCP \
      --host="${MCP_DB_HOST:-127.0.0.1}" \
      --port="${MCP_DB_PORT:-3306}" \
      --user="${MCP_ADMIN_USER:-root}" \
      --default-character-set=utf8mb4

unset pw
echo "mcp_readonly is ready (password set, SELECT on the five vw_* views, max 5 connections)."
