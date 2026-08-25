ALTER TABLE visits ADD COLUMN as_organization TEXT;
ALTER TABLE visits ADD COLUMN continent TEXT;
ALTER TABLE visits ADD COLUMN timezone TEXT;
ALTER TABLE visits ADD COLUMN http_protocol TEXT;
ALTER TABLE visits ADD COLUMN tls_version TEXT;
ALTER TABLE visits ADD COLUMN client_tcp_rtt_ms INTEGER
  CHECK (client_tcp_rtt_ms IS NULL OR client_tcp_rtt_ms BETWEEN 0 AND 600000);
ALTER TABLE visits ADD COLUMN accept_language TEXT;
ALTER TABLE visits ADD COLUMN sec_fetch_site TEXT;
ALTER TABLE visits ADD COLUMN cf_bot_score INTEGER
  CHECK (cf_bot_score IS NULL OR cf_bot_score BETWEEN 1 AND 99);
ALTER TABLE visits ADD COLUMN cf_verified_bot INTEGER
  CHECK (cf_verified_bot IS NULL OR cf_verified_bot IN (0, 1));
ALTER TABLE visits ADD COLUMN cf_corporate_proxy INTEGER
  CHECK (cf_corporate_proxy IS NULL OR cf_corporate_proxy IN (0, 1));

CREATE INDEX visits_ip_address_visited_at_utc_idx
  ON visits (ip_address, visited_at_utc);
