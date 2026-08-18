-- Runs only on the FIRST initialization of the Postgres volume.
-- (docker compose down -v removes the volume and makes this script run again)
-- The development database comes from POSTGRES_DB; here we create the test one.
CREATE DATABASE omniboard_test;
