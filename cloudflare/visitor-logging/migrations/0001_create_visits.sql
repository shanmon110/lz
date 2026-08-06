CREATE TABLE visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visited_at_utc TEXT NOT NULL,
  ip_address TEXT NOT NULL CHECK (length(ip_address) BETWEEN 1 AND 45),
  method TEXT NOT NULL,
  host TEXT NOT NULL,
  path TEXT NOT NULL,
  query_string TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  browser_summary TEXT NOT NULL DEFAULT '',
  country TEXT,
  region TEXT,
  city TEXT,
  asn INTEGER,
  colo TEXT,
  cf_ray TEXT,
  is_suspected_bot INTEGER NOT NULL DEFAULT 0 CHECK (is_suspected_bot IN (0, 1))
);

CREATE INDEX visits_visited_at_utc_idx ON visits (visited_at_utc);
CREATE INDEX visits_ip_address_idx ON visits (ip_address);
CREATE INDEX visits_country_idx ON visits (country);
CREATE INDEX visits_path_idx ON visits (path);
CREATE INDEX visits_is_suspected_bot_visited_at_utc_idx
  ON visits (is_suspected_bot, visited_at_utc);
