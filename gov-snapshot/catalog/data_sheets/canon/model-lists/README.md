# Canon model list artifacts

This folder stores non-authoritative Canon model-list artifacts used during data acquisition and curation.

## Purpose
- `canon_digital_canon_models_raw.txt` - Raw Canon digital camera model list pulled from source lookups.
- `canon_digital_canon_models.txt` - Canon digital model list cleaned for duplicates/formatting.
- `canon_digital_models_refined.txt` - Human/refiner filtered list used for review.
- `canon_eos_digital_wiki_list.txt` - EOS-derived subset from wiki list extraction.
- `canon_eos_digital.txt` - Canon EOS model list before/after extra filtering.
- `canon_eos_only.txt` - EOS-only normalized list for checks.
- `canon_ixus_elph_digital.txt` - IXUS/ELPH digital model list.
- `canon_ixy_ixus_elph.txt` - IXY/IXUS/ELPH normalization input set.
- `canon_powershot_digital.txt` - PowerShot digital model list raw.
- `canon_powershot_only.txt` - PowerShot-only filtered list.
- `canon_digital_still_models_scaffolded.tsv` - Generated index of scaffolded Canon digital still models (slug + family + display_name).
- `canon_datasheet_import_readiness.tsv` - Generated readiness report for datasheet->DB import (ready/skipped/error + missing requirements).

## Governance / workflow notes
- Keep source outputs here, not in product code.
- Do not copy machine-local absolute paths into docs or code. Use workspace-relative paths.
- When generating new source artifacts, preserve this raw/refined split to keep auditability.
- Treat these files as inputs for the canonical brand/model ingestion pipeline, then promote approved records into governance and product data structures.
