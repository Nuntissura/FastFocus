# Restart Wave Status

The active catalog tree was reset on 2026-03-20.

This file tracks the clean restart-era intake order before real datasheets are created.

Rules:

- Start from the brand `model-lists/restart_launch_wave.tsv` shortlist files.
- Do not recreate the archived broad placeholder tree.
- Only scaffold datasheets for models that are explicitly selected in a restart wave manifest.
- Draft datasheets are allowed, but they should exist for a curated shortlist, not a whole historical back-catalog.

Current wave order:

1. `sony/model-lists/restart_launch_wave.tsv` (`WP-0062`, active)
2. `nikon/model-lists/restart_launch_wave.tsv` (`WP-0063`)
3. `fujifilm/model-lists/restart_launch_wave.tsv` (`WP-0064`)
4. `panasonic/model-lists/restart_launch_wave.tsv` (`WP-0065`)
5. `olympus/model-lists/restart_launch_wave.tsv` (`WP-0065`)
6. `om-system/model-lists/restart_launch_wave.tsv` (`WP-0065`)
7. `canon/model-lists/restart_launch_wave.tsv` (`WP-0066`)

Preferred workflow:

1. Review the shortlist TSV.
2. Confirm the selected models still match current product priorities.
3. Use `FF - gov/catalog/scripts/scaffold_restart_wave_datasheets.ps1` only for the selected shortlist.
4. Replace scaffold-level facts with authoritative sources before considering a model ready for import.

Current active checkpoint:

- The selected restart launch waves are now complete across all seven active brands with 41 validated camera datasheets:
  - Sony: 8
  - Nikon: 8
  - Fujifilm: 8
  - Panasonic: 5
  - Olympus: 2
  - OM System: 2
  - Canon: 8
- Every selected model now has a real `datasheet.yaml`, official product/support provenance, non-placeholder used-buying utility, and a local hero image with attribution.
- The product repo `gov-snapshot` has been refreshed from this active tree.
- Verification evidence for the full active wave:
  - `FF - gov/catalog/scripts/validate_datasheet_templates.ps1` passed with 41 checked datasheets
  - `npm.cmd run smoke:datasheets` passed against `sony,nikon,fujifilm,panasonic,olympus,om-system,canon`
  - `scripts/local_prod_drill.ps1` now defaults to the full seven-brand set and passed after being hardened to avoid common local Postgres port collisions
- Catalog work should now prefer depth and usefulness on the selected launch models over broad placeholder expansion.
