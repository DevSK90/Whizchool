-- Runs once, when the Postgres volume is first created.
-- The API's tests use their own database so they never touch development data.
CREATE DATABASE whizchool_test OWNER whizchool;
