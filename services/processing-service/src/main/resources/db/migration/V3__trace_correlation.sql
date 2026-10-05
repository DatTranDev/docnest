-- Correlation survives asynchronous worker execution and service restart.
ALTER TABLE jobs ADD COLUMN trace_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL;
