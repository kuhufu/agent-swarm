#!/usr/bin/env node
import Database from "better-sqlite3";

const [, , dbPath, username, role] = process.argv;

if (!dbPath || !username || !role) {
  console.error("Usage: node scripts/set-user-role.mjs <db-path> <username> <admin|user>");
  process.exit(1);
}

if (role !== "admin" && role !== "user") {
  console.error("role must be either admin or user");
  process.exit(1);
}

const db = new Database(dbPath);
try {
  const result = db.prepare("UPDATE users SET role = ? WHERE username = ?").run(role, username);
  if (result.changes === 0) {
    console.error(`user not found: ${username}`);
    process.exit(1);
  }
  console.log(`updated ${username} role to ${role}`);
} finally {
  db.close();
}
