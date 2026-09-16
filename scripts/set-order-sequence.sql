-- ============================================================
-- Set order display_id sequence to start from 3000
-- ============================================================
-- Run this ONCE on the PRODUCTION PostgreSQL database
-- BEFORE the first real order is placed after migration.
--
-- This ensures order numbers start from #3000 onwards,
-- continuing from where the WooCommerce store left off.
--
-- Usage:
--   psql $DATABASE_URL -f set-order-sequence.sql
--
-- Or via Coolify's database console:
--   Connect to the PostgreSQL service and run these commands.
-- ============================================================

-- First, check the current sequence value
SELECT last_value, is_called FROM order_display_id_seq;

-- Set the sequence to restart from 3000
ALTER SEQUENCE order_display_id_seq RESTART WITH 3000;

-- Verify the change
SELECT last_value, is_called FROM order_display_id_seq;

-- The next order placed will get display_id = 3000
