-- 03-create-mcp-user.sql : creates or re-keys the read-only MCP database user.
--
-- DO NOT run this file directly. Run db-setup/run-03-create-mcp-user.sh (or .ps1), which
-- reads MCP_DB_PASSWORD from the environment and sends "SET @mcp_pw := '...';" on stdin
-- before this file. The password appears nowhere in this file.
--
-- Run 02-mcp-views.sql first (the GRANTs need the views). Run as a privileged account
-- (CREATE USER, GRANT OPTION or equivalent, CREATE ROUTINE on larchmont).
-- Re-running changes the password (ALTER USER), which is the rotation path, and resets the
-- grants to exactly the five views.
--
-- Logging: the password is held in a session variable and in a prepared statement text.
-- Do not run this client with -v/--verbose, and be aware that a server general query log
-- records the SET @mcp_pw statement. See docs/mcp-security.md.
-- NOT EXECUTED by the author: no MySQL server was available when this was written.

SET NAMES utf8mb4;

-- Abort with a clear error when the password variable is missing or empty.
-- (A top-level script has no IF, so the check lives in a short-lived procedure.
-- The mysql client stops at the first error unless --force is given.)
DROP PROCEDURE IF EXISTS larchmont._mcp_require_password;
DELIMITER $$
CREATE PROCEDURE larchmont._mcp_require_password(IN pw TEXT)
BEGIN
  IF pw IS NULL OR pw = '' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'MCP password missing: set MCP_DB_PASSWORD and run run-03-create-mcp-user.sh; nothing was created';
  END IF;
END$$
DELIMITER ;
CALL larchmont._mcp_require_password(@mcp_pw);
DROP PROCEDURE larchmont._mcp_require_password;

-- Create the user if it does not exist, then always set the password (rotation on re-run).
SET @mcp_sql := CONCAT('CREATE USER IF NOT EXISTS ''mcp_readonly''@''%'' IDENTIFIED BY ', QUOTE(@mcp_pw));
PREPARE mcp_stmt FROM @mcp_sql;
EXECUTE mcp_stmt;
DEALLOCATE PREPARE mcp_stmt;

SET @mcp_sql := CONCAT('ALTER USER ''mcp_readonly''@''%'' IDENTIFIED BY ', QUOTE(@mcp_pw));
PREPARE mcp_stmt FROM @mcp_sql;
EXECUTE mcp_stmt;
DEALLOCATE PREPARE mcp_stmt;

-- Forget the secret in this session.
SET @mcp_sql := NULL;
SET @mcp_pw  := NULL;

-- Start from nothing. The user exists at this point (created above), so this cannot fail
-- with "no such user"; on a user with no privileges it is a no-op.
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'mcp_readonly'@'%';

-- SELECT on the five views only. Nothing on base tables.
GRANT SELECT ON larchmont.vw_rooms_status       TO 'mcp_readonly'@'%';
GRANT SELECT ON larchmont.vw_sla_breaches       TO 'mcp_readonly'@'%';
GRANT SELECT ON larchmont.vw_ooo_impact         TO 'mcp_readonly'@'%';
GRANT SELECT ON larchmont.vw_housekeeper_load   TO 'mcp_readonly'@'%';
GRANT SELECT ON larchmont.vw_arrivals_vs_ready  TO 'mcp_readonly'@'%';

ALTER USER 'mcp_readonly'@'%' WITH MAX_USER_CONNECTIONS 5;

FLUSH PRIVILEGES;
