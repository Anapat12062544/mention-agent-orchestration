#!/bin/sh
# Runs once on first container start (docker-entrypoint-initdb.d).
# ai_reader = the only role the AI's SQL ever runs as: login, read-only, short timeouts.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  CREATE ROLE ai_reader LOGIN PASSWORD '${AI_READER_PASSWORD:-reader_dev_pw}'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 10;
  ALTER ROLE ai_reader SET default_transaction_read_only = on;
  ALTER ROLE ai_reader SET statement_timeout = '8s';
  ALTER ROLE ai_reader SET idle_in_transaction_session_timeout = '15s';
  REVOKE ALL ON SCHEMA public FROM PUBLIC;
  REVOKE ALL ON DATABASE "$POSTGRES_DB" FROM PUBLIC;
  GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO ai_reader;
SQL
