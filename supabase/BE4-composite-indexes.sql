-- BE4 (Batch F, 2026-05-26): defensive composite indexes for the two
-- read paths that page-by-user, newest-first.
--
-- Status: these indexes are already declared in supabase/schema.sql
--   (bedrock_time_log_user_idx on line 208, site_audits_user_idx on line 186).
-- They are listed here only so Brock can re-run them safely against the
-- live DB if it ever drifts from schema.sql. Both statements use
-- "if not exists" so they are no-ops when the indexes are already present.
--
-- Read patterns these support:
--   bedrock_time_log?user_id=eq.<uid>&order=created_at.desc        (log-time-event.js:74)
--   site_audits?user_id=eq.<uid>&order=created_at.desc&limit=...   (get-audits.js:27)
--
-- DO NOT RUN unless asked by Brock — handing this off, not executing.

create index if not exists bedrock_time_log_user_idx
  on bedrock_time_log (user_id, created_at desc);

create index if not exists site_audits_user_idx
  on site_audits (user_id, created_at desc);
