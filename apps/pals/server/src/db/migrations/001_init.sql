-- PALS schema v1 → docs/AgentArchitectureV2.md §5 (domain DDL adopted from v1 §4)
-- All timestamps ISO-8601 UTC text; local_day = 'YYYY-MM-DD' in America/New_York.

-- ========== CHAT ==========
CREATE TABLE thread (
  id TEXT PRIMARY KEY,
  title TEXT,
  sdk_session_id TEXT,
  model_override TEXT,
  kind TEXT CHECK(kind IN ('user','heartbeat','cron')) DEFAULT 'user',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE message (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
  role TEXT CHECK(role IN ('user','assistant','system')) NOT NULL,
  parts TEXT NOT NULL,
  usage TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_message_thread ON message(thread_id, created_at);

-- ========== FOOD & NUTRITION ==========
CREATE TABLE food_log (
  id INTEGER PRIMARY KEY,
  eaten_at TEXT NOT NULL,
  local_day TEXT NOT NULL,
  meal TEXT CHECK(meal IN ('breakfast','lunch','dinner','snack')),
  description TEXT NOT NULL,
  kcal REAL, protein_g REAL, carbs_g REAL, fat_g REAL, fiber_g REAL,
  confidence TEXT CHECK(confidence IN ('high','medium','low')),
  source TEXT CHECK(source IN ('text','photo','recipe','restaurant')),
  photo_path TEXT,
  recipe_id INTEGER REFERENCES recipe(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_food_local_day ON food_log(local_day);

CREATE TABLE pantry_item (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT CHECK(location IN ('pantry','fridge','freezer')),
  quantity REAL, unit TEXT,
  purchased_on TEXT, expires_on TEXT,
  is_staple INTEGER NOT NULL DEFAULT 0,
  reorder_threshold REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pantry_expires ON pantry_item(expires_on);

CREATE TABLE recipe (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL, instructions TEXT,
  servings INTEGER,
  kcal_per_serving REAL, protein_g REAL, carbs_g REAL, fat_g REAL,
  rating INTEGER CHECK(rating BETWEEN 1 AND 5),
  tags TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE recipe_ingredient (
  id INTEGER PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  name TEXT NOT NULL, quantity REAL, unit TEXT
);
CREATE TABLE grocery_list_item (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, quantity REAL, unit TEXT,
  aisle TEXT, checked INTEGER NOT NULL DEFAULT 0,
  added_by TEXT CHECK(added_by IN ('mealplan','staple','manual')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ========== TRAINING & BODY ==========
CREATE TABLE workout (
  id INTEGER PRIMARY KEY,
  performed_at TEXT NOT NULL, local_day TEXT NOT NULL,
  name TEXT, notes TEXT, rpe_session REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE workout_set (
  id INTEGER PRIMARY KEY,
  workout_id INTEGER NOT NULL REFERENCES workout(id) ON DELETE CASCADE,
  exercise TEXT NOT NULL,
  set_number INTEGER, reps INTEGER, weight_lb REAL, rpe REAL,
  is_pr INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_set_exercise ON workout_set(exercise);

CREATE TABLE body_metric (
  id INTEGER PRIMARY KEY,
  measured_at TEXT NOT NULL, local_day TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  source TEXT
);
CREATE INDEX idx_body_metric ON body_metric(metric, local_day);

-- ========== WEARABLE / RECOVERY ==========
CREATE TABLE health_daily (
  local_day TEXT PRIMARY KEY,
  steps INTEGER, active_kcal REAL, resting_hr REAL, hrv_ms REAL,
  sleep_minutes INTEGER, sleep_deep_min INTEGER, sleep_rem_min INTEGER,
  vo2max REAL, source TEXT DEFAULT 'apple_health',
  ingested_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ========== MIND ==========
CREATE TABLE mood_log (
  id INTEGER PRIMARY KEY,
  logged_at TEXT NOT NULL, local_day TEXT NOT NULL,
  mood INTEGER CHECK(mood BETWEEN 1 AND 5),
  energy INTEGER CHECK(energy BETWEEN 1 AND 5),
  stress INTEGER CHECK(stress BETWEEN 1 AND 5),
  note TEXT
);
CREATE TABLE journal_entry (
  id INTEGER PRIMARY KEY,
  written_at TEXT NOT NULL, local_day TEXT NOT NULL,
  body TEXT NOT NULL,
  embedded INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE goal (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL, domain TEXT, target_value REAL, unit TEXT,
  cadence TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE habit_event (
  id INTEGER PRIMARY KEY,
  goal_id INTEGER REFERENCES goal(id) ON DELETE CASCADE,
  local_day TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 1
);

-- ========== HEALTHCARE OPS ==========
CREATE TABLE insurance_plan (
  id INTEGER PRIMARY KEY,
  plan_name TEXT NOT NULL,
  plan_year INTEGER NOT NULL,
  deductible_individual REAL, deductible_family REAL,
  oop_max_individual REAL, oop_max_family REAL,
  coinsurance_pct REAL
);
CREATE TABLE claim (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER REFERENCES insurance_plan(id),
  service_date TEXT, provider TEXT, description TEXT,
  billed REAL, allowed REAL, plan_paid REAL, patient_owed REAL,
  applied_to_deductible REAL, applied_to_oop REAL,
  status TEXT CHECK(status IN ('submitted','processed','paid','denied','appeal')),
  eob_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE prior_auth (
  id INTEGER PRIMARY KEY,
  service TEXT, provider TEXT, submitted_on TEXT,
  status TEXT CHECK(status IN ('pending','approved','denied')),
  expires_on TEXT, notes TEXT
);
CREATE TABLE medication (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, dose TEXT, schedule TEXT,
  is_supplement INTEGER NOT NULL DEFAULT 0,
  days_supply INTEGER, last_filled_on TEXT, refills_left INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE lab_result (
  id INTEGER PRIMARY KEY,
  drawn_on TEXT NOT NULL, panel TEXT, analyte TEXT NOT NULL,
  value REAL, unit TEXT, ref_low REAL, ref_high REAL, flag TEXT
);
CREATE INDEX idx_lab_analyte ON lab_result(analyte, drawn_on);
CREATE TABLE hsa_contribution (
  id INTEGER PRIMARY KEY,
  contributed_on TEXT NOT NULL, tax_year INTEGER NOT NULL,
  amount REAL NOT NULL, source TEXT
);

-- ========== MONEY ==========
CREATE TABLE account (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, type TEXT,
  institution TEXT, plaid_item_id TEXT, is_read_only INTEGER DEFAULT 1
);
CREATE TABLE transaction_row (
  id INTEGER PRIMARY KEY,
  account_id INTEGER REFERENCES account(id),
  posted_on TEXT NOT NULL, amount REAL NOT NULL,
  merchant TEXT, category TEXT, is_recurring INTEGER DEFAULT 0,
  source TEXT CHECK(source IN ('plaid','csv','manual')),
  import_hash TEXT UNIQUE
);
CREATE INDEX idx_txn_posted ON transaction_row(posted_on);
CREATE TABLE budget (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL, monthly_limit REAL NOT NULL, active INTEGER DEFAULT 1
);
CREATE TABLE holding (
  id INTEGER PRIMARY KEY,
  account_id INTEGER REFERENCES account(id),
  symbol TEXT NOT NULL, shares REAL, cost_basis REAL,
  asset_class TEXT, target_pct REAL,
  as_of TEXT
);
CREATE TABLE subscription (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, amount REAL, cadence TEXT,
  next_charge_on TEXT, last_used_on TEXT, flagged_unused INTEGER DEFAULT 0
);

-- ========== LIFE ADMIN ==========
CREATE TABLE task (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL, notes TEXT, domain TEXT,
  due_on TEXT, recur_rule TEXT,
  priority INTEGER DEFAULT 3,
  status TEXT CHECK(status IN ('open','done','snoozed','cancelled')) DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_task_due ON task(due_on, status);
CREATE TABLE document (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL, category TEXT,
  file_path TEXT NOT NULL, added_on TEXT, indexed INTEGER DEFAULT 0
);
CREATE TABLE price_watch (
  id INTEGER PRIMARY KEY,
  item TEXT NOT NULL, url TEXT, target_price REAL,
  last_price REAL, last_checked TEXT, active INTEGER DEFAULT 1
);

-- ========== SOCIAL ==========
CREATE TABLE contact (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, relationship TEXT,
  birthday TEXT, keep_in_touch_days INTEGER, last_contacted_on TEXT,
  gift_ideas TEXT, notes TEXT
);
CREATE TABLE reading_item (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL, author TEXT, kind TEXT,
  status TEXT CHECK(status IN ('backlog','reading','done')) DEFAULT 'backlog',
  rating INTEGER, added_on TEXT
);

-- ========== SYSTEM / AUTONOMY ==========
CREATE TABLE approval (
  id TEXT PRIMARY KEY,
  tier INTEGER NOT NULL, action TEXT NOT NULL, payload TEXT NOT NULL,
  reasoning TEXT, confidence REAL, reversibility TEXT,
  thread_id TEXT,
  status TEXT CHECK(status IN ('pending','approved','denied','expired')) DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT,
  decided_at TEXT
);
CREATE TABLE action_audit (
  id INTEGER PRIMARY KEY,
  tool TEXT NOT NULL, tier INTEGER, args TEXT, result TEXT,
  decision TEXT,
  thread_id TEXT,
  session_kind TEXT,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE token_usage (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  model TEXT, input_tokens INTEGER, output_tokens INTEGER,
  cache_read INTEGER, cache_write INTEGER,
  cost_usd REAL, session_kind TEXT, thread_id TEXT
);
