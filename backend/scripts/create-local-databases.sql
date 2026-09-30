-- One-off setup for developing against a locally installed PostgreSQL instead
-- of Docker Compose. Run once as a superuser, for example:
--
--   psql -U postgres -f backend/scripts/create-local-databases.sql
--
-- It creates the same role and databases that docker-compose.yml provides, so
-- the connection strings in .env.example work unchanged (apart from the port).
-- These credentials are for local development only.

CREATE ROLE bank LOGIN PASSWORD 'bank';

CREATE DATABASE bank_dev OWNER bank;
CREATE DATABASE bank_test OWNER bank;
