#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${1:-./data/agent-swarm.db}"
TARGET_USER_ID="${2:-}"
LEGACY_USER_ID="__public__"
RAG_DB_PATH="${DB_PATH%.db}-rag.db"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "错误: 未找到 sqlite3 命令" >&2
  exit 1
fi

if [[ ! -f "${DB_PATH}" ]]; then
  echo "错误: 数据库不存在: ${DB_PATH}" >&2
  exit 1
fi

if [[ -z "${TARGET_USER_ID}" ]]; then
  echo "用法: $0 <db_path> <target_user_id>" >&2
  exit 1
fi

USER_EXISTS="$(sqlite3 "${DB_PATH}" "SELECT COUNT(1) FROM users WHERE id = '${TARGET_USER_ID}';")"
if [[ "${USER_EXISTS}" != "1" ]]; then
  echo "错误: users 表中不存在目标用户 ${TARGET_USER_ID}" >&2
  exit 1
fi

sqlite3 "${DB_PATH}" <<SQL
BEGIN;
UPDATE conversations
SET user_id = '${TARGET_USER_ID}'
WHERE user_id = '${LEGACY_USER_ID}' OR user_id IS NULL OR trim(user_id) = '';

UPDATE swarms
SET user_id = '${TARGET_USER_ID}'
WHERE user_id = '${LEGACY_USER_ID}' OR user_id IS NULL OR trim(user_id) = '';

UPDATE preset_agents
SET user_id = '${TARGET_USER_ID}'
WHERE user_id = '${LEGACY_USER_ID}' OR user_id IS NULL OR trim(user_id) = '';
COMMIT;
SQL

if [[ -f "${RAG_DB_PATH}" ]]; then
  sqlite3 "${RAG_DB_PATH}" <<SQL
BEGIN;
UPDATE rag_documents
SET user_id = '${TARGET_USER_ID}'
WHERE user_id = '${LEGACY_USER_ID}' OR user_id IS NULL OR trim(user_id) = '';
COMMIT;
SQL
fi

echo "迁移完成:"
echo "  主库: ${DB_PATH}"
[[ -f "${RAG_DB_PATH}" ]] && echo "  知识库: ${RAG_DB_PATH}"

echo "剩余 legacy user_id 数量:"
sqlite3 "${DB_PATH}" <<SQL
SELECT 'conversations', COUNT(1) FROM conversations WHERE user_id = '${LEGACY_USER_ID}';
SELECT 'swarms', COUNT(1) FROM swarms WHERE user_id = '${LEGACY_USER_ID}';
SELECT 'preset_agents', COUNT(1) FROM preset_agents WHERE user_id = '${LEGACY_USER_ID}';
SQL

if [[ -f "${RAG_DB_PATH}" ]]; then
  sqlite3 "${RAG_DB_PATH}" "SELECT 'rag_documents', COUNT(1) FROM rag_documents WHERE user_id = '${LEGACY_USER_ID}';"
fi
