---
name: supabase-postgres
description: PostgreSQL best practices for Supabase. Use when writing queries, designing schemas, or optimizing database performance.
---

# Supabase Postgres Best Practices

> Performance optimization guide for PostgreSQL on Supabase.

## Trigger

`/postgres` or "optimize this query" or "database best practices"

## Rule Categories (by Priority)

| Priority | Category | Prefix |
|----------|----------|--------|
| CRITICAL | Query Performance | `query-` |
| CRITICAL | Connection Management | `conn-` |
| CRITICAL | Security & RLS | `security-` |
| HIGH | Schema Design | `schema-` |
| MEDIUM-HIGH | Concurrency & Locking | `lock-` |
| MEDIUM | Data Access Patterns | `data-` |
| LOW-MEDIUM | Monitoring | `monitor-` |
| LOW | Advanced Features | `advanced-` |

## Query Performance (CRITICAL)

### Use Indexes Properly

```sql
-- BAD: Full table scan
SELECT * FROM orders WHERE customer_email = 'user@example.com';

-- GOOD: Create index first
CREATE INDEX idx_orders_customer_email ON orders(customer_email);
SELECT * FROM orders WHERE customer_email = 'user@example.com';
```

### Avoid SELECT *

```sql
-- BAD: Fetches all columns
SELECT * FROM users WHERE id = 1;

-- GOOD: Only needed columns
SELECT id, name, email FROM users WHERE id = 1;
```

### Use EXPLAIN ANALYZE

```sql
-- Check query performance
EXPLAIN ANALYZE
SELECT * FROM orders
WHERE created_at > '2024-01-01'
ORDER BY created_at DESC
LIMIT 100;

-- Look for:
-- - Seq Scan (bad on large tables)
-- - Index Scan (good)
-- - Actual rows vs estimated rows
```

### Pagination with Cursors

```sql
-- BAD: OFFSET is slow on large datasets
SELECT * FROM posts ORDER BY created_at DESC LIMIT 20 OFFSET 10000;

-- GOOD: Cursor-based pagination
SELECT * FROM posts
WHERE created_at < '2024-01-15T10:30:00Z'
ORDER BY created_at DESC
LIMIT 20;
```

### Batch Operations

```sql
-- BAD: Individual inserts
INSERT INTO logs (message) VALUES ('log1');
INSERT INTO logs (message) VALUES ('log2');

-- GOOD: Batch insert
INSERT INTO logs (message) VALUES
  ('log1'),
  ('log2'),
  ('log3');
```

## Connection Management (CRITICAL)

### Use Connection Pooling

```typescript
// Supabase client handles pooling automatically
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(url, key, {
  db: { schema: 'public' },
  auth: { persistSession: true },
});

// For direct Postgres, use pgbouncer
// Connection string: postgresql://...?pgbouncer=true
```

### Close Connections

```typescript
// In serverless functions, connections auto-close
// For long-running processes, handle cleanup

process.on('SIGTERM', async () => {
  await supabase.removeAllChannels();
  process.exit(0);
});
```

## Security & RLS (CRITICAL)

### Enable Row Level Security

```sql
-- Enable RLS
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view own posts"
ON posts FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own posts"
ON posts FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own posts"
ON posts FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
```

### Service Role Bypasses RLS

```typescript
// Client-side (respects RLS)
const supabase = createClient(url, anonKey);

// Server-side (bypasses RLS - use carefully)
const supabaseAdmin = createClient(url, serviceRoleKey);
```

### Validate Input

```sql
-- Use constraints
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  age INT CHECK (age >= 0 AND age < 150)
);
```

## Schema Design (HIGH)

### Use Appropriate Types

```sql
-- BAD
CREATE TABLE events (
  id SERIAL,
  event_time TEXT,  -- Storing timestamp as text
  data TEXT         -- Storing JSON as text
);

-- GOOD
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);
```

### Normalize When Appropriate

```sql
-- For frequently updated data, normalize
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL
);

CREATE TABLE profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT
);
```

### Use Foreign Keys

```sql
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT
);
```

### Index Foreign Keys

```sql
-- Always index foreign keys used in joins
CREATE INDEX idx_posts_user_id ON posts(user_id);
```

## Concurrency & Locking (MEDIUM-HIGH)

### Avoid Long Transactions

```sql
-- BAD: Long-running transaction
BEGIN;
-- ... lots of operations over minutes ...
COMMIT;

-- GOOD: Short, focused transactions
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;
```

### Use SELECT FOR UPDATE Carefully

```sql
-- Lock specific rows when needed
BEGIN;
SELECT * FROM inventory WHERE product_id = 1 FOR UPDATE;
UPDATE inventory SET quantity = quantity - 1 WHERE product_id = 1;
COMMIT;
```

## Data Access Patterns (MEDIUM)

### Use UPSERT

```sql
-- Insert or update in one operation
INSERT INTO user_settings (user_id, theme, notifications)
VALUES ('user-123', 'dark', true)
ON CONFLICT (user_id)
DO UPDATE SET
  theme = EXCLUDED.theme,
  notifications = EXCLUDED.notifications;
```

### Partial Indexes

```sql
-- Index only active records
CREATE INDEX idx_orders_pending
ON orders(created_at)
WHERE status = 'pending';
```

### Use JSONB Operators

```sql
-- Query JSONB efficiently
CREATE INDEX idx_data_category ON events USING GIN ((data->'category'));

SELECT * FROM events
WHERE data->>'category' = 'purchase'
AND data->'amount' > '100';
```

## Monitoring (LOW-MEDIUM)

### Check Slow Queries

```sql
-- Enable in Supabase dashboard or:
SELECT query, calls, mean_time, total_time
FROM pg_stat_statements
ORDER BY total_time DESC
LIMIT 10;
```

### Table Sizes

```sql
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC;
```

### Index Usage

```sql
SELECT
  indexrelname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;
```

## Quick Reference

| Task | Solution |
|------|----------|
| Slow query | Add index, check EXPLAIN |
| N+1 queries | Use joins or batch fetch |
| Large offset | Cursor pagination |
| Duplicate inserts | Use UPSERT |
| Complex filters | Partial indexes |
| JSON queries | GIN index on JSONB |
| Auth per-row | RLS policies |
| Serverless connections | Use pgbouncer |

## Source

Based on Supabase's agent-skills postgres best practices.
