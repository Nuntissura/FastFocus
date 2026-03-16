import fs from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import { resolveGovRoot } from "../paths.js";

let cached = null;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeSections(raw) {
  const sectionsIn = Array.isArray(raw) ? raw : [];
  const sections = [];

  for (const sec of sectionsIn) {
    if (!sec || typeof sec !== "object") continue;
    const sectionId = isNonEmptyString(sec.section_id) ? sec.section_id.trim() : null;
    const label = isNonEmptyString(sec.label) ? sec.label.trim() : null;
    const rowsIn = Array.isArray(sec.rows) ? sec.rows : [];
    const rows = [];

    for (const row of rowsIn) {
      if (!row || typeof row !== "object") continue;
      const rowLabel = isNonEmptyString(row.label) ? row.label.trim() : null;
      const fieldPaths = Array.isArray(row.field_paths) ? row.field_paths.filter(isNonEmptyString).map((s) => s.trim()) : [];
      if (!rowLabel || fieldPaths.length === 0) continue;
      rows.push({ label: rowLabel, field_paths: fieldPaths });
    }

    if (!label || rows.length === 0) continue;
    sections.push({ section_id: sectionId, label, rows });
  }

  return sections;
}

export async function loadDigitalCameraCompareSections() {
  if (cached) return cached;

  const govRoot = resolveGovRoot();
  const templatePath = path.resolve(govRoot, "workflow", "templates", "digital_camera_datasheet.v5.yaml");
  const raw = await fs.readFile(templatePath, "utf-8");
  const doc = parseYaml(raw);

  const sections = normalizeSections(doc?.display?.comparison_sections);
  cached = sections;
  return sections;
}

