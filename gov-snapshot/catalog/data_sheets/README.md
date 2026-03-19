# Fast Focus Data Sheets

This is the canonical repository folder for website model pages.

Layout:

- `data_sheets/<brand_slug>/` (for example: `canon`, `sony`, `nikon`)
- `data_sheets/<brand_slug>/<model_slug>/`
- `datasheet.yaml` in each model folder from `FF - gov/workflow/templates/digital_camera_datasheet.v5.yaml`
- Model photos/videos in `images/`
- Discovery source lists belong in `FF - gov/catalog/data_sheets/<brand_slug>/model-lists/` and are documented in the Codex (`FF - gov/FAST_FOCUS_CODEX.md`) before creating model folders.

Use this structure only as a content layer; database import/seeding remains controlled by existing seed contracts and scripts.

Quick onboarding checklist:

- [ ] Create or update `data_sheets/<brand_slug>/`
- [ ] Add model folder `data_sheets/<brand_slug>/<model_slug>/`
- [ ] Copy `FF - gov/workflow/templates/digital_camera_datasheet.v5.yaml` to `datasheet.yaml`
- [ ] Fill required sections and validate key slugs
- [ ] Run `FF - gov/catalog/scripts/validate_datasheet_templates.ps1`
- [ ] Add at least one hero image in `images/`
