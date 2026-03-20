# Fast Focus Data Sheets

This is the canonical repository folder for website model pages.

Reset baseline:

- The active tree was intentionally reset on 2026-03-20 for a clean restart.
- The former live Canon tree now lives in `FF - gov/catalog/archive/catalog_reset_20260320/canon_placeholder_tree/`.
- Do not repopulate this folder from the archived tree wholesale.
- Only add new brand/model folders that belong to the restart-era brand/group work packets.
- Use `FF - gov/catalog/data_sheets/WAVE_STATUS.md` and the brand `model-lists/restart_launch_wave.tsv` files as the intake source of truth before creating datasheets.

Layout:

- `data_sheets/<brand_slug>/` (for example: `canon`, `sony`, `nikon`)
- `data_sheets/<brand_slug>/<model_slug>/`
- `datasheet.yaml` in each model folder from `FF - gov/workflow/templates/digital_camera_datasheet.v5.yaml`
- Model photos/videos in `images/`
- Discovery source lists belong in `FF - gov/catalog/data_sheets/<brand_slug>/model-lists/` and are documented in the Codex (`FF - gov/FAST_FOCUS_CODEX.md`) before creating model folders.
- A brand folder may contain only `model-lists/` during intake planning; do not assume every selected model needs a scaffold immediately.

Use this structure only as a content layer; database import/seeding remains controlled by existing seed contracts and scripts.

Quick onboarding checklist:

- [ ] Create or update `data_sheets/<brand_slug>/`
- [ ] Confirm the model appears in that brand's `model-lists/restart_launch_wave.tsv`
- [ ] Add model folder `data_sheets/<brand_slug>/<model_slug>/`
- [ ] Copy `FF - gov/workflow/templates/digital_camera_datasheet.v5.yaml` to `datasheet.yaml`
- [ ] Fill required sections and validate key slugs
- [ ] Run `FF - gov/catalog/scripts/validate_datasheet_templates.ps1`
- [ ] Add at least one hero image in `images/`
- [ ] Add real editorial content and provenance before treating a datasheet as active, not just scaffold-complete
