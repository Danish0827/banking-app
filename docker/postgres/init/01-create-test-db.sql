-- Separate database for the integration test suite, so tests never touch dev data.
CREATE DATABASE bank_test OWNER bank;
