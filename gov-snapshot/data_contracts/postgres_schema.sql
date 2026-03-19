-- Fast Focus Phase 1 PostgreSQL schema (OLTP / system-of-record)
-- Design goals:
--   - AI-friendly canonical entities (typed columns + JSONB for flexible modules)
--   - Append-only history tables (listing_snapshots, events) for analytics/warehouse export
--   - No paid services assumed; batch pipelines can export these tables later (e.g., to ClickHouse)

BEGIN;

-- Extensions (pgcrypto for gen_random_uuid; pg_trgm optional for fuzzy search)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -------------------------
-- ENUM TYPES
-- -------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'capture_medium_enum') THEN
    CREATE TYPE capture_medium_enum AS ENUM ('digital', 'film');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'camera_category_enum') THEN
    CREATE TYPE camera_category_enum AS ENUM (
      'mirrorless','dslr','compact','rangefinder','slr_film','tlr_film','medium_format','instant','other'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lens_system_type_enum') THEN
    CREATE TYPE lens_system_type_enum AS ENUM ('interchangeable', 'fixed');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lens_category_enum') THEN
    CREATE TYPE lens_category_enum AS ENUM ('prime','zoom','teleconverter','other');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sensor_format_enum') THEN
    CREATE TYPE sensor_format_enum AS ENUM (
      'full_frame','aps_c','aps_h','micro_four_thirds','one_inch',
      'one_over_1_6_inch','one_over_1_7_inch','one_over_1_8_inch','one_over_2_0_inch',
      'one_over_2_3_inch','one_over_2_5_inch','one_over_2_7_inch','one_over_3_0_inch',
      'medium_format_44x33','medium_format_645','other'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'film_format_enum') THEN
    CREATE TYPE film_format_enum AS ENUM (
      '135','120','110','220','instax_mini','instax_wide','polaroid_600','polaroid_i_type','4x5','8x10','other'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'condition_physical_tier_enum') THEN
    CREATE TYPE condition_physical_tier_enum AS ENUM ('new','like_new','used_excellent','used_good','used_fair','for_parts');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'functional_status_enum') THEN
    CREATE TYPE functional_status_enum AS ENUM ('working','untested','not_working','unknown');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'seller_type_enum') THEN
    CREATE TYPE seller_type_enum AS ENUM ('private','business','unknown');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'match_status_enum') THEN
    CREATE TYPE match_status_enum AS ENUM ('unmatched','matched','needs_review','verified');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_name_enum') THEN
    CREATE TYPE event_name_enum AS ENUM (
      'page_view','site_search','compare_view','listing_impression','listing_clickout','outbound_clickout',
      'newsletter_signup','alert_created','error'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'page_type_enum') THEN
    CREATE TYPE page_type_enum AS ENUM ('model','compare','brand','guide','search','other');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'newsletter_segment_enum') THEN
    CREATE TYPE newsletter_segment_enum AS ENUM ('street','hybrid','video','retro');
  END IF;

END$$;

-- Ensure newly added sensor formats exist (idempotent for existing DBs).
ALTER TYPE sensor_format_enum ADD VALUE IF NOT EXISTS 'aps_h';
ALTER TYPE sensor_format_enum ADD VALUE IF NOT EXISTS 'one_over_1_6_inch';
ALTER TYPE sensor_format_enum ADD VALUE IF NOT EXISTS 'one_over_1_8_inch';
ALTER TYPE sensor_format_enum ADD VALUE IF NOT EXISTS 'one_over_2_0_inch';
ALTER TYPE sensor_format_enum ADD VALUE IF NOT EXISTS 'one_over_2_5_inch';
ALTER TYPE sensor_format_enum ADD VALUE IF NOT EXISTS 'one_over_2_7_inch';
ALTER TYPE sensor_format_enum ADD VALUE IF NOT EXISTS 'one_over_3_0_inch';

-- -------------------------
-- COMMON TRIGGER FOR updated_at
-- -------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -------------------------
-- DIMENSION TABLES
-- -------------------------

CREATE TABLE IF NOT EXISTS brands (
  brand_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+){0,127}$'),
  name       TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_brands_updated_at ON brands;
CREATE TRIGGER trg_brands_updated_at
BEFORE UPDATE ON brands
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Marketplace/source registry (small cardinality; keeps listing.source consistent)
CREATE TABLE IF NOT EXISTS marketplaces (
  marketplace_code TEXT PRIMARY KEY CHECK (marketplace_code ~ '^[a-z0-9_]{2,32}$'),
  display_name     TEXT NOT NULL,
  affiliate_supported BOOLEAN NOT NULL DEFAULT FALSE,

  -- Partner (B2B) fields (WP-0018)
  partner_status TEXT NOT NULL DEFAULT 'none' CHECK (partner_status IN ('none','prospect','active','paused','ended')),
  partner_kind TEXT NOT NULL DEFAULT 'marketplace' CHECK (partner_kind IN ('marketplace','retailer','other')),
  affiliate_params_template TEXT NULL CHECK (affiliate_params_template IS NULL OR char_length(affiliate_params_template) <= 2048),

  -- Sponsored placement controls (must be clearly labeled in UI when enabled)
  is_sponsored BOOLEAN NOT NULL DEFAULT FALSE,
  sponsored_rank SMALLINT NOT NULL DEFAULT 0 CHECK (sponsored_rank BETWEEN 0 AND 1000),
  sponsored_label TEXT NULL CHECK (sponsored_label IS NULL OR char_length(sponsored_label) <= 80),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE marketplaces
  ADD COLUMN IF NOT EXISTS partner_status TEXT NOT NULL DEFAULT 'none' CHECK (partner_status IN ('none','prospect','active','paused','ended')),
  ADD COLUMN IF NOT EXISTS partner_kind TEXT NOT NULL DEFAULT 'marketplace' CHECK (partner_kind IN ('marketplace','retailer','other')),
  ADD COLUMN IF NOT EXISTS affiliate_params_template TEXT NULL CHECK (affiliate_params_template IS NULL OR char_length(affiliate_params_template) <= 2048),
  ADD COLUMN IF NOT EXISTS is_sponsored BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sponsored_rank SMALLINT NOT NULL DEFAULT 0 CHECK (sponsored_rank BETWEEN 0 AND 1000),
  ADD COLUMN IF NOT EXISTS sponsored_label TEXT NULL CHECK (sponsored_label IS NULL OR char_length(sponsored_label) <= 80);

-- -------------------------
-- CORE CATALOG: camera_models (digital + film)
-- -------------------------
CREATE TABLE IF NOT EXISTS camera_models (
  camera_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version TEXT NOT NULL DEFAULT '1.0' CHECK (schema_version ~ '^\d+\.\d+$'),

  slug          TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+){0,127}$'),
  brand_id      UUID NOT NULL REFERENCES brands(brand_id),
  display_name  TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 120),

  capture_medium capture_medium_enum NOT NULL,
  camera_category camera_category_enum NOT NULL,

  lens_system_type lens_system_type_enum NOT NULL,
  mount_code     TEXT NULL CHECK (mount_code IS NULL OR mount_code ~ '^[a-z0-9_]{2,40}$'),
  fixed_focal_length_basis TEXT NULL CHECK (fixed_focal_length_basis IS NULL OR fixed_focal_length_basis IN ('physical','equiv_35mm')),
  fixed_focal_length_min_mm INTEGER NULL CHECK (fixed_focal_length_min_mm IS NULL OR (fixed_focal_length_min_mm BETWEEN 1 AND 2000)),
  fixed_focal_length_max_mm INTEGER NULL CHECK (fixed_focal_length_max_mm IS NULL OR (fixed_focal_length_max_mm BETWEEN 1 AND 2000)),
  fixed_max_aperture_wide_f  NUMERIC(4,1) NULL CHECK (fixed_max_aperture_wide_f IS NULL OR (fixed_max_aperture_wide_f BETWEEN 0.7 AND 32.0)),
  fixed_max_aperture_tele_f  NUMERIC(4,1) NULL CHECK (fixed_max_aperture_tele_f IS NULL OR (fixed_max_aperture_tele_f BETWEEN 0.7 AND 32.0)),

  announce_date DATE NULL,
  release_year  SMALLINT NULL CHECK (release_year IS NULL OR (release_year BETWEEN 1900 AND 2100)),
  msrp_amount   NUMERIC(12,2) NULL CHECK (msrp_amount IS NULL OR msrp_amount >= 0),
  msrp_currency CHAR(3) NULL CHECK (msrp_currency IS NULL OR msrp_currency ~ '^[A-Z]{3}$'),

  production_start_year SMALLINT NULL CHECK (production_start_year IS NULL OR (production_start_year BETWEEN 1900 AND 2100)),
  production_end_year   SMALLINT NULL CHECK (production_end_year IS NULL OR (production_end_year BETWEEN 1900 AND 2100)),
  is_discontinued BOOLEAN NOT NULL DEFAULT FALSE,
  production_confidence NUMERIC(3,2) NOT NULL DEFAULT 0.50 CHECK (production_confidence BETWEEN 0 AND 1),

  weight_g INTEGER NULL CHECK (weight_g IS NULL OR (weight_g BETWEEN 1 AND 5000)),
  weather_sealed BOOLEAN NULL,
  dimensions_w_mm SMALLINT NULL CHECK (dimensions_w_mm IS NULL OR (dimensions_w_mm BETWEEN 1 AND 500)),
  dimensions_h_mm SMALLINT NULL CHECK (dimensions_h_mm IS NULL OR (dimensions_h_mm BETWEEN 1 AND 500)),
  dimensions_d_mm SMALLINT NULL CHECK (dimensions_d_mm IS NULL OR (dimensions_d_mm BETWEEN 1 AND 500)),

  -- Key digital fields (optional but useful for comparisons and filtering later)
  sensor_format sensor_format_enum NULL,
  sensor_type   TEXT NULL,
  resolution_mp NUMERIC(5,1) NULL CHECK (resolution_mp IS NULL OR (resolution_mp BETWEEN 0.1 AND 200.0)),
  ibis          BOOLEAN NULL,
  video_max     TEXT NULL,
  storage_media TEXT[] NULL,
  battery_model TEXT NULL,

  -- Key film fields
  film_format  film_format_enum NULL,
  frame_size   TEXT NULL,
  dx_coding    BOOLEAN NULL,
  metering     TEXT NULL,
  focus_type   TEXT NULL,
  flash        TEXT NULL,
  shutter_type TEXT NULL,

  -- Flexible extension blobs (keep future changes from forcing migrations)
  digital_specs JSONB NULL,
  film_specs    JSONB NULL,

  aliases  TEXT[] NOT NULL DEFAULT '{}',
  links    JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_modules JSONB NOT NULL DEFAULT '{"bio":null,"used_buying_checklist":[],"known_issues":[]}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Basic invariants
  CONSTRAINT camera_models_msrp_currency_requires_amount CHECK (
    (msrp_currency IS NULL AND msrp_amount IS NULL) OR (msrp_currency IS NOT NULL AND msrp_amount IS NOT NULL)
  ),
  CONSTRAINT camera_models_lens_system_invariant CHECK (
    (
      lens_system_type = 'interchangeable'
      AND mount_code IS NOT NULL
      AND fixed_focal_length_basis IS NULL
      AND fixed_focal_length_min_mm IS NULL
      AND fixed_focal_length_max_mm IS NULL
      AND fixed_max_aperture_wide_f IS NULL
      AND fixed_max_aperture_tele_f IS NULL
    )
    OR
    (
      lens_system_type = 'fixed'
      AND mount_code IS NULL
      AND fixed_focal_length_basis IS NOT NULL
      AND fixed_focal_length_min_mm IS NOT NULL
      AND fixed_focal_length_max_mm IS NOT NULL
      AND fixed_max_aperture_wide_f IS NOT NULL
      AND fixed_max_aperture_tele_f IS NOT NULL
      AND fixed_focal_length_min_mm <= fixed_focal_length_max_mm
    )
  ),
  CONSTRAINT camera_models_capture_medium_invariant CHECK (
    (capture_medium = 'digital' AND film_format IS NULL)
    OR
    (capture_medium = 'film' AND sensor_format IS NULL AND resolution_mp IS NULL)
  )
);

DROP TRIGGER IF EXISTS trg_camera_models_updated_at ON camera_models;
CREATE TRIGGER trg_camera_models_updated_at
BEFORE UPDATE ON camera_models
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Helpful indexes for navigation and comparisons
CREATE INDEX IF NOT EXISTS idx_camera_models_brand ON camera_models(brand_id);
CREATE INDEX IF NOT EXISTS idx_camera_models_medium ON camera_models(capture_medium);
CREATE INDEX IF NOT EXISTS idx_camera_models_mount ON camera_models(mount_code);
CREATE INDEX IF NOT EXISTS idx_camera_models_release_year ON camera_models(release_year);

ALTER TABLE camera_models
  ALTER COLUMN content_modules SET DEFAULT '{"bio":null,"used_buying_checklist":[],"known_issues":[]}'::jsonb;

-- Optional: if you enable pg_trgm
-- CREATE INDEX IF NOT EXISTS idx_camera_models_display_name_trgm ON camera_models USING gin (display_name gin_trgm_ops);

-- -------------------------
-- CORE CATALOG: lens_models (interchangeable)
-- -------------------------
CREATE TABLE IF NOT EXISTS lens_models (
  lens_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version TEXT NOT NULL DEFAULT '1.0' CHECK (schema_version ~ '^\d+\.\d+$'),

  slug          TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+){0,127}$'),
  brand_id      UUID NOT NULL REFERENCES brands(brand_id),
  display_name  TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 120),

  mount_code     TEXT NOT NULL CHECK (mount_code ~ '^[a-z0-9_]{2,40}$'),
  coverage_format sensor_format_enum NULL,
  lens_category  lens_category_enum NOT NULL DEFAULT 'other',

  focal_length_min_mm INTEGER NOT NULL CHECK (focal_length_min_mm BETWEEN 1 AND 2000),
  focal_length_max_mm INTEGER NOT NULL CHECK (focal_length_max_mm BETWEEN 1 AND 2000),
  max_aperture_wide_f  NUMERIC(4,1) NOT NULL CHECK (max_aperture_wide_f BETWEEN 0.7 AND 32.0),
  max_aperture_tele_f  NUMERIC(4,1) NOT NULL CHECK (max_aperture_tele_f BETWEEN 0.7 AND 32.0),

  has_is BOOLEAN NULL,
  weight_g INTEGER NULL CHECK (weight_g IS NULL OR (weight_g BETWEEN 1 AND 5000)),
  weather_sealed BOOLEAN NULL,

  announce_date DATE NULL,
  release_year  SMALLINT NULL CHECK (release_year IS NULL OR (release_year BETWEEN 1900 AND 2100)),
  msrp_amount   NUMERIC(12,2) NULL CHECK (msrp_amount IS NULL OR msrp_amount >= 0),
  msrp_currency CHAR(3) NULL CHECK (msrp_currency IS NULL OR msrp_currency ~ '^[A-Z]{3}$'),

  production_start_year SMALLINT NULL CHECK (production_start_year IS NULL OR (production_start_year BETWEEN 1900 AND 2100)),
  production_end_year   SMALLINT NULL CHECK (production_end_year IS NULL OR (production_end_year BETWEEN 1900 AND 2100)),
  is_discontinued BOOLEAN NOT NULL DEFAULT FALSE,
  production_confidence NUMERIC(3,2) NOT NULL DEFAULT 0.50 CHECK (production_confidence BETWEEN 0 AND 1),

  optical_specs JSONB NULL,

  aliases  TEXT[] NOT NULL DEFAULT '{}',
  links    JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_modules JSONB NOT NULL DEFAULT '{"bio":null,"used_buying_checklist":[],"known_issues":[]}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT lens_models_msrp_currency_requires_amount CHECK (
    (msrp_currency IS NULL AND msrp_amount IS NULL) OR (msrp_currency IS NOT NULL AND msrp_amount IS NOT NULL)
  ),
  CONSTRAINT lens_models_focal_range_invariant CHECK (focal_length_min_mm <= focal_length_max_mm),
  CONSTRAINT lens_models_aperture_range_invariant CHECK (max_aperture_wide_f <= max_aperture_tele_f)
);

DROP TRIGGER IF EXISTS trg_lens_models_updated_at ON lens_models;
CREATE TRIGGER trg_lens_models_updated_at
BEFORE UPDATE ON lens_models
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_lens_models_brand ON lens_models(brand_id);
CREATE INDEX IF NOT EXISTS idx_lens_models_mount ON lens_models(mount_code);
CREATE INDEX IF NOT EXISTS idx_lens_models_release_year ON lens_models(release_year);

ALTER TABLE lens_models
  ALTER COLUMN content_modules SET DEFAULT '{"bio":null,"used_buying_checklist":[],"known_issues":[]}'::jsonb;

-- -------------------------
-- MARKET: listings (latest state) + listing_snapshots (append-only history)
-- -------------------------

CREATE TABLE IF NOT EXISTS listings (
  listing_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version TEXT NOT NULL DEFAULT '1.0' CHECK (schema_version ~ '^\d+\.\d+$'),

  marketplace_code TEXT NOT NULL REFERENCES marketplaces(marketplace_code),
  source_item_id   TEXT NOT NULL CHECK (char_length(source_item_id) BETWEEN 1 AND 128),
  url              TEXT NOT NULL CHECK (char_length(url) <= 2048),

  title            TEXT NOT NULL CHECK (char_length(title) <= 256),

  last_retrieved_at TIMESTAMPTZ NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,

  camera_id        UUID NULL REFERENCES camera_models(camera_id),
  lens_id          UUID NULL REFERENCES lens_models(lens_id),
  match_status     match_status_enum NOT NULL DEFAULT 'unmatched',
  match_confidence NUMERIC(3,2) NOT NULL DEFAULT 0.00 CHECK (match_confidence BETWEEN 0 AND 1),
  match_method     TEXT NULL CHECK (match_method IS NULL OR char_length(match_method) <= 64),

  price_amount     NUMERIC(12,2) NOT NULL CHECK (price_amount >= 0),
  price_currency   CHAR(3) NOT NULL CHECK (price_currency ~ '^[A-Z]{3}$'),
  shipping_amount  NUMERIC(12,2) NULL CHECK (shipping_amount IS NULL OR shipping_amount >= 0),
  shipping_currency CHAR(3) NULL CHECK (shipping_currency IS NULL OR shipping_currency ~ '^[A-Z]{3}$'),
  fees_included    BOOLEAN NOT NULL DEFAULT TRUE,

  condition_raw    TEXT NULL CHECK (condition_raw IS NULL OR char_length(condition_raw) <= 128),
  condition_physical_tier condition_physical_tier_enum NOT NULL DEFAULT 'used_good',
  functional_status functional_status_enum NOT NULL DEFAULT 'unknown',

  seller_type      seller_type_enum NOT NULL DEFAULT 'unknown',
  seller_id        TEXT NULL CHECK (seller_id IS NULL OR char_length(seller_id) <= 128),
  seller_rating    NUMERIC(4,2) NULL CHECK (seller_rating IS NULL OR (seller_rating BETWEEN 0 AND 5.0)),

  country          CHAR(2) NULL CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  region           TEXT NULL CHECK (region IS NULL OR char_length(region) <= 128),
  city             TEXT NULL CHECK (city IS NULL OR char_length(city) <= 128),
  pickup_possible  BOOLEAN NULL,

  included_items       JSONB NOT NULL DEFAULT '[]'::jsonb,
  extracted_attributes JSONB NOT NULL DEFAULT '[]'::jsonb,
  media               JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_ref             JSONB NOT NULL DEFAULT '{}'::jsonb,

  first_seen_at    TIMESTAMPTZ NOT NULL,
  last_seen_at     TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT listings_source_unique UNIQUE (marketplace_code, source_item_id),
  CONSTRAINT listings_shipping_currency_requires_amount CHECK (
    (shipping_currency IS NULL AND shipping_amount IS NULL) OR (shipping_currency IS NOT NULL AND shipping_amount IS NOT NULL)
  )
);

-- Keep schema application idempotent for existing DBs (CREATE TABLE IF NOT EXISTS won't add new columns).
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS lens_id UUID NULL REFERENCES lens_models(lens_id),
  ADD COLUMN IF NOT EXISTS deal_score NUMERIC(5,2) NULL CHECK (deal_score IS NULL OR (deal_score BETWEEN 0 AND 100)),
  ADD COLUMN IF NOT EXISTS deal_score_version TEXT NULL CHECK (deal_score_version IS NULL OR char_length(deal_score_version) <= 32),
  ADD COLUMN IF NOT EXISTS deal_score_confidence NUMERIC(3,2) NULL CHECK (deal_score_confidence IS NULL OR (deal_score_confidence BETWEEN 0 AND 1)),
  ADD COLUMN IF NOT EXISTS deal_score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS deal_score_computed_at TIMESTAMPTZ NULL;

DROP TRIGGER IF EXISTS trg_listings_updated_at ON listings;
CREATE TRIGGER trg_listings_updated_at
BEFORE UPDATE ON listings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Core performance indexes
CREATE INDEX IF NOT EXISTS idx_listings_camera_last_seen ON listings(camera_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_lens_last_seen ON listings(lens_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_market_last_seen ON listings(marketplace_code, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_active ON listings(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price_currency, price_amount);
CREATE INDEX IF NOT EXISTS idx_listings_deal_score ON listings(deal_score DESC) WHERE deal_score IS NOT NULL;

-- JSONB indexes (useful when you start querying attributes/items)
CREATE INDEX IF NOT EXISTS idx_listings_extracted_attributes_gin ON listings USING GIN (extracted_attributes jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_listings_included_items_gin ON listings USING GIN (included_items jsonb_path_ops);

-- Append-only listing snapshots: store each retrieval for time series / price history.
CREATE TABLE IF NOT EXISTS listing_snapshots (
  snapshot_id BIGSERIAL PRIMARY KEY,
  listing_id UUID NOT NULL REFERENCES listings(listing_id),

  marketplace_code TEXT NOT NULL,
  source_item_id   TEXT NOT NULL,

  retrieved_at TIMESTAMPTZ NOT NULL,
  is_active    BOOLEAN NOT NULL,

  camera_id    UUID NULL,
  lens_id      UUID NULL,
  price_amount NUMERIC(12,2) NOT NULL CHECK (price_amount >= 0),
  price_currency CHAR(3) NOT NULL CHECK (price_currency ~ '^[A-Z]{3}$'),

  condition_physical_tier condition_physical_tier_enum NOT NULL,
  functional_status       functional_status_enum NOT NULL,

  snapshot JSONB NOT NULL
);

ALTER TABLE listing_snapshots
  ADD COLUMN IF NOT EXISTS lens_id UUID NULL;

-- Time-series indexes: BRIN for large sequential inserts; B-tree for joins.
CREATE INDEX IF NOT EXISTS idx_listing_snapshots_listing_time ON listing_snapshots(listing_id, retrieved_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_snapshots_camera_time ON listing_snapshots(camera_id, retrieved_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_snapshots_lens_time ON listing_snapshots(lens_id, retrieved_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_snapshots_retrieved_brin ON listing_snapshots USING BRIN (retrieved_at);

-- Dedupe edges: keep raw listings intact, but link obvious duplicates.
-- UI/query layers can exclude duplicates by filtering where listing_id NOT IN (SELECT duplicate_listing_id FROM listing_dedupe_edges).
CREATE TABLE IF NOT EXISTS listing_dedupe_edges (
  edge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  canonical_listing_id UUID NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
  duplicate_listing_id UUID NOT NULL UNIQUE REFERENCES listings(listing_id) ON DELETE CASCADE,

  method TEXT NOT NULL CHECK (char_length(method) <= 64),
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.50 CHECK (confidence BETWEEN 0 AND 1),
  reason TEXT NULL CHECK (reason IS NULL OR char_length(reason) <= 256),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT listing_dedupe_not_self CHECK (canonical_listing_id <> duplicate_listing_id)
);

CREATE INDEX IF NOT EXISTS idx_listing_dedupe_edges_canonical ON listing_dedupe_edges(canonical_listing_id);

-- -------------------------
-- DERIVED: price observations (daily/weekly computed aggregates)
-- -------------------------
CREATE TABLE IF NOT EXISTS price_observations (
  price_observation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_id UUID NOT NULL REFERENCES camera_models(camera_id),
  observed_date DATE NOT NULL,
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  country CHAR(2) NULL CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  region  TEXT NULL CHECK (region IS NULL OR char_length(region) <= 128),
  condition_physical_tier condition_physical_tier_enum NULL,

  sample_size INTEGER NOT NULL DEFAULT 0 CHECK (sample_size >= 0),

  p25    NUMERIC(12,2) NULL,
  median NUMERIC(12,2) NULL,
  p75    NUMERIC(12,2) NULL,
  min    NUMERIC(12,2) NULL,
  max    NUMERIC(12,2) NULL,

  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  method TEXT NOT NULL DEFAULT 'trimmed_median_v1',

  CONSTRAINT ux_price_observations_dim UNIQUE NULLS NOT DISTINCT (camera_id, observed_date, currency, country, region, condition_physical_tier)
);

CREATE INDEX IF NOT EXISTS idx_price_observations_date ON price_observations(observed_date);
CREATE INDEX IF NOT EXISTS idx_price_observations_camera ON price_observations(camera_id);

CREATE TABLE IF NOT EXISTS lens_price_observations (
  lens_price_observation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lens_id UUID NOT NULL REFERENCES lens_models(lens_id),
  observed_date DATE NOT NULL,
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  country CHAR(2) NULL CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  region  TEXT NULL CHECK (region IS NULL OR char_length(region) <= 128),
  condition_physical_tier condition_physical_tier_enum NULL,

  sample_size INTEGER NOT NULL DEFAULT 0 CHECK (sample_size >= 0),

  p25    NUMERIC(12,2) NULL,
  median NUMERIC(12,2) NULL,
  p75    NUMERIC(12,2) NULL,
  min    NUMERIC(12,2) NULL,
  max    NUMERIC(12,2) NULL,

  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  method TEXT NOT NULL DEFAULT 'trimmed_median_v1',

  CONSTRAINT ux_lens_price_observations_dim UNIQUE NULLS NOT DISTINCT (lens_id, observed_date, currency, country, region, condition_physical_tier)
);

CREATE INDEX IF NOT EXISTS idx_lens_price_observations_date ON lens_price_observations(observed_date);
CREATE INDEX IF NOT EXISTS idx_lens_price_observations_lens ON lens_price_observations(lens_id);

-- Backward-compatible migration from older composite primary keys (which forced NULLable dims to NOT NULL)
ALTER TABLE price_observations ADD COLUMN IF NOT EXISTS price_observation_id UUID DEFAULT gen_random_uuid();
ALTER TABLE lens_price_observations ADD COLUMN IF NOT EXISTS lens_price_observation_id UUID DEFAULT gen_random_uuid();

ALTER TABLE price_observations DROP CONSTRAINT IF EXISTS price_observations_pkey;
ALTER TABLE lens_price_observations DROP CONSTRAINT IF EXISTS lens_price_observations_pkey;

ALTER TABLE price_observations ALTER COLUMN price_observation_id SET NOT NULL;
ALTER TABLE lens_price_observations ALTER COLUMN lens_price_observation_id SET NOT NULL;

ALTER TABLE price_observations ALTER COLUMN country DROP NOT NULL;
ALTER TABLE price_observations ALTER COLUMN region DROP NOT NULL;
ALTER TABLE price_observations ALTER COLUMN condition_physical_tier DROP NOT NULL;

ALTER TABLE lens_price_observations ALTER COLUMN country DROP NOT NULL;
ALTER TABLE lens_price_observations ALTER COLUMN region DROP NOT NULL;
ALTER TABLE lens_price_observations ALTER COLUMN condition_physical_tier DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'price_observations_pk'
  ) THEN
    ALTER TABLE price_observations
      ADD CONSTRAINT price_observations_pk PRIMARY KEY (price_observation_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lens_price_observations_pk'
  ) THEN
    ALTER TABLE lens_price_observations
      ADD CONSTRAINT lens_price_observations_pk PRIMARY KEY (lens_price_observation_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ux_price_observations_dim'
  ) THEN
    ALTER TABLE price_observations
      ADD CONSTRAINT ux_price_observations_dim
        UNIQUE NULLS NOT DISTINCT (camera_id, observed_date, currency, country, region, condition_physical_tier);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ux_lens_price_observations_dim'
  ) THEN
    ALTER TABLE lens_price_observations
      ADD CONSTRAINT ux_lens_price_observations_dim
        UNIQUE NULLS NOT DISTINCT (lens_id, observed_date, currency, country, region, condition_physical_tier);
  END IF;
END $$;

-- -------------------------
-- PROVENANCE: source evidence for important facts
-- -------------------------
CREATE TABLE IF NOT EXISTS source_evidence (
  evidence_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('camera_model','lens_model','listing','price_observation')),
  entity_id   UUID NOT NULL,
  claim_path  TEXT NOT NULL CHECK (char_length(claim_path) <= 200),

  source_type TEXT NOT NULL CHECK (source_type IN ('manufacturer','wikidata','wikipedia','retailer','marketplace','manual','other')),
  source_url  TEXT NOT NULL CHECK (char_length(source_url) <= 2048),
  retrieved_at TIMESTAMPTZ NOT NULL,

  license TEXT NOT NULL DEFAULT 'link_only' CHECK (char_length(license) <= 64),
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.50 CHECK (confidence BETWEEN 0 AND 1),

  value_json JSONB NULL,
  notes TEXT NULL CHECK (notes IS NULL OR char_length(notes) <= 500),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_source_evidence_entity ON source_evidence(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_source_evidence_claim ON source_evidence(claim_path);
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_evidence_dedupe ON source_evidence(entity_type, entity_id, claim_path, source_url);

-- -------------------------
-- EVENTS: append-only site analytics (minimal, warehouse-ready)
-- -------------------------
CREATE TABLE IF NOT EXISTS events (
  event_id BIGSERIAL PRIMARY KEY,
  event_uuid UUID NOT NULL DEFAULT gen_random_uuid(),

  occurred_at TIMESTAMPTZ NOT NULL,
  event_name event_name_enum NOT NULL,

  session_id TEXT NOT NULL CHECK (char_length(session_id) BETWEEN 8 AND 64),

  page_type page_type_enum NOT NULL,
  path TEXT NOT NULL CHECK (char_length(path) <= 512),

  camera_id UUID NULL REFERENCES camera_models(camera_id),
  compare_camera_id UUID NULL REFERENCES camera_models(camera_id),
  listing_id UUID NULL REFERENCES listings(listing_id),

  referrer TEXT NULL CHECK (referrer IS NULL OR char_length(referrer) <= 2048),
  utm JSONB NOT NULL DEFAULT '{}'::jsonb,

  user_agent TEXT NULL CHECK (user_agent IS NULL OR char_length(user_agent) <= 512),
  is_bot BOOLEAN NOT NULL DEFAULT FALSE,
  bot_name TEXT NULL CHECK (bot_name IS NULL OR char_length(bot_name) <= 64),

  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_time_brin ON events USING BRIN (occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_name_time ON events(event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_camera_time ON events(camera_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_clickouts ON events(occurred_at DESC) WHERE event_name IN ('listing_clickout','outbound_clickout');

-- -------------------------
-- OPS: HTTP request logs (bot/crawler monitoring)
-- -------------------------
CREATE TABLE IF NOT EXISTS http_request_logs (
  request_id BIGSERIAL PRIMARY KEY,

  occurred_at TIMESTAMPTZ NOT NULL,
  method TEXT NOT NULL CHECK (char_length(method) <= 12),
  path TEXT NOT NULL CHECK (char_length(path) <= 512),
  listing_id UUID NULL,

  status_code INT NOT NULL CHECK (status_code BETWEEN 100 AND 599),
  response_ms INT NULL CHECK (response_ms IS NULL OR (response_ms BETWEEN 0 AND 600000)),

  referrer TEXT NULL CHECK (referrer IS NULL OR char_length(referrer) <= 2048),
  utm JSONB NOT NULL DEFAULT '{}'::jsonb,

  user_agent TEXT NULL CHECK (user_agent IS NULL OR char_length(user_agent) <= 512),
  is_bot BOOLEAN NOT NULL DEFAULT FALSE,
  bot_name TEXT NULL CHECK (bot_name IS NULL OR char_length(bot_name) <= 64),

  ip_hash TEXT NULL CHECK (ip_hash IS NULL OR char_length(ip_hash) <= 64),

  cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE http_request_logs
  ADD COLUMN IF NOT EXISTS listing_id UUID NULL;

CREATE INDEX IF NOT EXISTS idx_http_request_logs_time_brin ON http_request_logs USING BRIN (occurred_at);
CREATE INDEX IF NOT EXISTS idx_http_request_logs_bot_time ON http_request_logs(is_bot, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_http_request_logs_bot_name_time ON http_request_logs(bot_name, occurred_at DESC) WHERE is_bot = TRUE;
CREATE INDEX IF NOT EXISTS idx_http_request_logs_ip_time ON http_request_logs(ip_hash, occurred_at DESC) WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_http_request_logs_path_time ON http_request_logs(path, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_http_request_logs_listing_time ON http_request_logs(listing_id, occurred_at DESC) WHERE listing_id IS NOT NULL;

-- -------------------------
-- RETENTION HOOKS: saved searches + email alerts (Phase 1)
-- -------------------------

CREATE TABLE IF NOT EXISTS saved_searches (
  saved_search_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version TEXT NOT NULL DEFAULT '1.0' CHECK (schema_version ~ '^\d+\.\d+$'),

  email TEXT NOT NULL CHECK (char_length(email) <= 254),
  email_norm TEXT NOT NULL CHECK (char_length(email_norm) <= 254),

  camera_id UUID NULL REFERENCES camera_models(camera_id),
  lens_id UUID NULL REFERENCES lens_models(lens_id),
  marketplace_code TEXT NULL REFERENCES marketplaces(marketplace_code),
  country CHAR(2) NULL CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  currency CHAR(3) NULL CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),

  max_total_price_amount NUMERIC(12,2) NULL CHECK (max_total_price_amount IS NULL OR max_total_price_amount >= 0),
  max_total_price_currency CHAR(3) NULL CHECK (max_total_price_currency IS NULL OR max_total_price_currency ~ '^[A-Z]{3}$'),

  confirmed_at TIMESTAMPTZ NULL,
  confirm_token TEXT NOT NULL UNIQUE CHECK (char_length(confirm_token) BETWEEN 16 AND 96),

  unsubscribed_at TIMESTAMPTZ NULL,
  unsubscribe_token TEXT NOT NULL UNIQUE CHECK (char_length(unsubscribe_token) BETWEEN 16 AND 96),

  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  min_interval_hours INT NOT NULL DEFAULT 24 CHECK (min_interval_hours BETWEEN 1 AND 168),
  max_results_per_email INT NOT NULL DEFAULT 10 CHECK (max_results_per_email BETWEEN 1 AND 50),

  last_checked_at TIMESTAMPTZ NULL,
  last_email_sent_at TIMESTAMPTZ NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT saved_search_has_target CHECK (camera_id IS NOT NULL OR lens_id IS NOT NULL),
  CONSTRAINT saved_search_max_currency_requires_amount CHECK (
    (max_total_price_currency IS NULL AND max_total_price_amount IS NULL) OR (max_total_price_currency IS NOT NULL AND max_total_price_amount IS NOT NULL)
  )
);

DROP TRIGGER IF EXISTS trg_saved_searches_updated_at ON saved_searches;
CREATE TRIGGER trg_saved_searches_updated_at
BEFORE UPDATE ON saved_searches
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_saved_searches_email_norm ON saved_searches(email_norm);
CREATE INDEX IF NOT EXISTS idx_saved_searches_enabled ON saved_searches(enabled) WHERE enabled = TRUE AND unsubscribed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_saved_searches_confirmed ON saved_searches(confirmed_at) WHERE confirmed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
  newsletter_subscription_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version TEXT NOT NULL DEFAULT '1.0' CHECK (schema_version ~ '^\d+\.\d+$'),

  email TEXT NOT NULL CHECK (char_length(email) <= 254),
  email_norm TEXT NOT NULL CHECK (char_length(email_norm) <= 254),

  segments newsletter_segment_enum[] NOT NULL DEFAULT '{}'::newsletter_segment_enum[],

  confirmed_at TIMESTAMPTZ NULL,
  confirm_token TEXT NOT NULL UNIQUE CHECK (char_length(confirm_token) BETWEEN 16 AND 96),

  unsubscribed_at TIMESTAMPTZ NULL,
  unsubscribe_token TEXT NOT NULL UNIQUE CHECK (char_length(unsubscribe_token) BETWEEN 16 AND 96),

  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_issue_sent_at TIMESTAMPTZ NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_newsletter_subscriptions_updated_at ON newsletter_subscriptions;
CREATE TRIGGER trg_newsletter_subscriptions_updated_at
BEFORE UPDATE ON newsletter_subscriptions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_newsletter_subscriptions_email_norm ON newsletter_subscriptions(email_norm);
CREATE INDEX IF NOT EXISTS idx_newsletter_subscriptions_enabled ON newsletter_subscriptions(enabled) WHERE enabled = TRUE AND unsubscribed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_newsletter_subscriptions_confirmed ON newsletter_subscriptions(confirmed_at) WHERE confirmed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS premium_subscriptions (
  premium_subscription_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version TEXT NOT NULL DEFAULT '1.0' CHECK (schema_version ~ '^\d+\.\d+$'),

  email TEXT NOT NULL CHECK (char_length(email) <= 254),
  email_norm TEXT NOT NULL CHECK (char_length(email_norm) <= 254),

  plan_code TEXT NOT NULL DEFAULT 'pro' CHECK (plan_code IN ('pro')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','canceled')),

  confirmed_at TIMESTAMPTZ NULL,
  confirm_token TEXT NOT NULL UNIQUE CHECK (char_length(confirm_token) BETWEEN 16 AND 96),

  access_token TEXT NOT NULL UNIQUE CHECK (char_length(access_token) BETWEEN 16 AND 128),

  canceled_at TIMESTAMPTZ NULL,
  cancel_token TEXT NOT NULL UNIQUE CHECK (char_length(cancel_token) BETWEEN 16 AND 96),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_premium_subscriptions_updated_at ON premium_subscriptions;
CREATE TRIGGER trg_premium_subscriptions_updated_at
BEFORE UPDATE ON premium_subscriptions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_premium_subscriptions_email_norm ON premium_subscriptions(email_norm);
CREATE INDEX IF NOT EXISTS idx_premium_subscriptions_status ON premium_subscriptions(status) WHERE status IN ('pending','active');
CREATE INDEX IF NOT EXISTS idx_premium_subscriptions_confirmed ON premium_subscriptions(confirmed_at) WHERE confirmed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_premium_subscriptions_canceled ON premium_subscriptions(canceled_at) WHERE canceled_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_messages (
  email_message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version TEXT NOT NULL DEFAULT '1.0' CHECK (schema_version ~ '^\d+\.\d+$'),

  message_type TEXT NOT NULL CHECK (message_type IN ('saved_search_confirm','saved_search_alert','newsletter_confirm','newsletter_weekly','premium_confirm')),
  saved_search_id UUID NULL REFERENCES saved_searches(saved_search_id) ON DELETE SET NULL,
  newsletter_subscription_id UUID NULL REFERENCES newsletter_subscriptions(newsletter_subscription_id) ON DELETE SET NULL,
  premium_subscription_id UUID NULL REFERENCES premium_subscriptions(premium_subscription_id) ON DELETE SET NULL,

  to_email TEXT NOT NULL CHECK (char_length(to_email) <= 254),
  from_email TEXT NULL CHECK (from_email IS NULL OR char_length(from_email) <= 254),

  subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  body_text TEXT NOT NULL CHECK (char_length(body_text) BETWEEN 1 AND 50000),

  status TEXT NOT NULL CHECK (status IN ('queued','sent','failed','simulated')),
  provider TEXT NOT NULL DEFAULT 'stdout' CHECK (char_length(provider) <= 32),
  provider_message_id TEXT NULL CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 256),
  error TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ NULL
);

ALTER TABLE email_messages
  ADD COLUMN IF NOT EXISTS newsletter_subscription_id UUID NULL REFERENCES newsletter_subscriptions(newsletter_subscription_id) ON DELETE SET NULL;

ALTER TABLE email_messages
  ADD COLUMN IF NOT EXISTS premium_subscription_id UUID NULL REFERENCES premium_subscriptions(premium_subscription_id) ON DELETE SET NULL;

-- Extend email_messages message_type for existing DBs (idempotent).
ALTER TABLE email_messages DROP CONSTRAINT IF EXISTS email_messages_message_type_check;
ALTER TABLE email_messages
  ADD CONSTRAINT email_messages_message_type_check CHECK (
    message_type IN ('saved_search_confirm','saved_search_alert','newsletter_confirm','newsletter_weekly','premium_confirm')
  );

CREATE INDEX IF NOT EXISTS idx_email_messages_saved_search_time ON email_messages(saved_search_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_newsletter_time ON email_messages(newsletter_subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_premium_time ON email_messages(premium_subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_to_time ON email_messages(to_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_type_time ON email_messages(message_type, created_at DESC);

CREATE TABLE IF NOT EXISTS saved_search_listing_deliveries (
  delivery_id BIGSERIAL PRIMARY KEY,
  saved_search_id UUID NOT NULL REFERENCES saved_searches(saved_search_id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
  email_message_id UUID NULL REFERENCES email_messages(email_message_id) ON DELETE SET NULL,
  matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ NULL,
  CONSTRAINT uq_saved_search_listing UNIQUE (saved_search_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_search_listing_deliveries_search_time ON saved_search_listing_deliveries(saved_search_id, matched_at DESC);

-- -------------------------
-- OPS: ingestion runs + audit log (low-touch operations)
-- -------------------------
CREATE TABLE IF NOT EXISTS ingestion_runs (
  run_id BIGSERIAL PRIMARY KEY,
  job_name TEXT NOT NULL CHECK (char_length(job_name) <= 64),
  marketplace_code TEXT NULL REFERENCES marketplaces(marketplace_code),

  started_at TIMESTAMPTZ NOT NULL,
  ended_at   TIMESTAMPTZ NULL,
  status     TEXT NOT NULL CHECK (status IN ('running','success','failed')),
  stats      JSONB NOT NULL DEFAULT '{}'::jsonb,
  error      TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_job_time ON ingestion_runs(job_name, started_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  audit_id BIGSERIAL PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('human','ai')),
  actor_id TEXT NOT NULL CHECK (char_length(actor_id) <= 64),
  action TEXT NOT NULL CHECK (char_length(action) <= 64),
  entity_type TEXT NOT NULL CHECK (char_length(entity_type) <= 32),
  entity_id UUID NULL,
  diff JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_time ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);

COMMIT;
