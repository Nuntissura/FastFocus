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

- `WP-0062` now has three real Sony anchor entries in the active tree:
  - `sony-a7-iv`
  - `sony-a6700`
  - `sony-zv-e10`
- Those three entries now include official Sony links, sourced core facts, editorial utility, and CC-licensed hero media with local attribution files.
