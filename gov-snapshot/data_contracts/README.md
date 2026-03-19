# Fast Focus Phase 1 - Data Contract

This folder is the Phase 1 canonical data contract:
- JSON Schemas for core objects (camera models, listings, events, evidence, etc.)
- A baseline PostgreSQL schema (`postgres_schema.sql`) aligned with a Postgres-first, batch-first architecture

Use these as the source of truth for:
- Field names, enums, units, and validation rules
- Storage-layer table design (OLTP system of record)
- Append-only fact tables for downstream analytics/warehouse export

