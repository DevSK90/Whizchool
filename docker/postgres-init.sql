-- Runs once, when the Postgres volume is first created.
-- Tests get their own databases so they never touch development data:
-- whizchool_test for the API tests, whizchool_contract for the contract suite over HTTP.
CREATE DATABASE whizchool_test OWNER whizchool;
CREATE DATABASE whizchool_contract OWNER whizchool;
