function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

function splitToken(token) {
  const t = token.toLowerCase();
  if (!t) return [];

  const mark = t.match(/^(mark|mk)([ivx]+|\d+)$/);
  if (mark) return [mark[1], mark[2]];

  const alphaNumRoman = t.match(/^([a-z]+)(\d+)([a-z]+)?([ivx]+)?$/);
  if (alphaNumRoman) {
    const [, letters, digits, suffixLetters, roman] = alphaNumRoman;
    const base = `${letters}${digits}${suffixLetters || ""}`;
    return roman ? [base, roman] : [base];
  }

  const digitsSuffix = t.match(/^(\d+)([a-z]+)$/);
  if (digitsSuffix) return [t];

  return [t];
}

function toSegments(text) {
  const segments = [];
  for (const token of tokenize(text)) {
    for (const seg of splitToken(token)) segments.push(seg);
  }
  return segments;
}

function toWordSegments(text) {
  return tokenize(text);
}

function stripPrefix(segments, prefixSegments) {
  if (prefixSegments.length === 0) return segments;
  if (segments.length < prefixSegments.length) return segments;
  for (let i = 0; i < prefixSegments.length; i += 1) {
    if (segments[i] !== prefixSegments[i]) return segments;
  }
  return segments.slice(prefixSegments.length);
}

function containsSubsequence(haystack, needle) {
  if (needle.length === 0) return false;
  if (needle.length > haystack.length) return false;
  for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    let ok = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function dedupeSequences(sequences) {
  const seen = new Set();
  const out = [];
  for (const seq of sequences) {
    const key = seq.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(seq);
  }
  return out;
}

function withCombinedPairs(seq) {
  const out = [seq];
  if (seq.length < 2) return out;

  const combined = [];
  for (let i = 0; i < seq.length; i += 1) {
    const a = seq[i];
    const b = i + 1 < seq.length ? seq[i + 1] : null;
    if (b && /^[a-z]+$/.test(a) && /[0-9]/.test(b)) {
      combined.push(`${a}${b}`);
      i += 1;
      continue;
    }
    combined.push(a);
  }
  if (combined.join(" ") !== seq.join(" ")) out.push(combined);
  return out;
}

function isDistinctiveSingleSegment(seg) {
  return /[0-9]/.test(seg) && seg.length >= 3;
}

function cameraConfidenceForMatch({ seqLength, brandPresent, strongSingle }) {
  let conf;
  if (seqLength >= 4) conf = 0.98;
  else if (seqLength === 3) conf = 0.96;
  else if (seqLength === 2) conf = 0.93;
  else if (strongSingle) conf = 0.92;
  else conf = 0.70;

  if (brandPresent) conf += 0.02;
  return Math.min(0.99, conf);
}

function pickWeakKey(segments) {
  for (const seg of segments) {
    if (/[0-9]/.test(seg)) return seg;
  }
  return segments[0] || null;
}

function buildCameraVariants({ displaySegments, brandSegments }) {
  const OPTIONAL_PREFIXES = new Set(["eos", "lumix"]);

  const stripped = stripPrefix(displaySegments, brandSegments);
  const base = stripped.length > 0 ? stripped : displaySegments;

  const variants = [base];

  if (base.length >= 2 && OPTIONAL_PREFIXES.has(base[0])) variants.push(base.slice(1));

  for (const v of [...variants]) {
    const hasMark = v.includes("mark");
    const hasMk = v.includes("mk");
    if (hasMark) variants.push(v.map((s) => (s === "mark" ? "mk" : s)));
    if (hasMark || hasMk) variants.push(v.filter((s) => s !== "mark" && s !== "mk"));
  }

  const expanded = [];
  for (const v of variants) {
    for (const combined of withCombinedPairs(v)) expanded.push(combined);
  }

  return dedupeSequences(expanded).filter((s) => s.length > 0);
}

export function buildCameraMatcher(cameraModels) {
  const candidates = cameraModels.map((m) => {
    const brandSegments = toSegments(m.brand_name);
    const displaySegments = toSegments(m.display_name);
    const variants = buildCameraVariants({ displaySegments, brandSegments });
    const weakKey = pickWeakKey(variants[0] || []);
    return {
      entity_type: "camera_model",
      entity_id: m.camera_id,
      slug: m.slug,
      display_name: m.display_name,
      brand_slug: m.brand_slug,
      brand_name: m.brand_name,
      brand_segments: brandSegments,
      variants,
      weak_key: weakKey,
    };
  });

  return {
    match(title) {
      const titleSegments = toSegments(title);
      const titleWords = new Set(toWordSegments(title));

      const results = [];
      for (const c of candidates) {
        const brandPresent = c.brand_segments.length > 0 && c.brand_segments.every((s) => titleWords.has(s));

        for (const variant of c.variants) {
          const strongSingle = variant.length === 1 && isDistinctiveSingleSegment(variant[0]);
          const strongEnough = variant.length >= 2 || strongSingle;
          if (!strongEnough) continue;

          if (containsSubsequence(titleSegments, variant)) {
            const confidence = cameraConfidenceForMatch({
              seqLength: variant.length,
              brandPresent,
              strongSingle,
            });
            results.push({
              entity_type: c.entity_type,
              entity_id: c.entity_id,
              slug: c.slug,
              confidence,
              method: "camera_title_seq_v0",
              matched_variant: variant,
            });
            break;
          }
        }
      }

      results.sort((a, b) => b.confidence - a.confidence || b.matched_variant.length - a.matched_variant.length);
      if (results.length > 0) return { best: results[0], top: results.slice(0, 3) };

      const weak = [];
      for (const c of candidates) {
        if (!c.weak_key) continue;
        if (!titleSegments.includes(c.weak_key)) continue;

        const brandPresent = c.brand_segments.length > 0 && c.brand_segments.every((s) => titleWords.has(s));
        const distinctive = isDistinctiveSingleSegment(c.weak_key);
        if (!brandPresent && !distinctive) continue;

        let confidence = 0.60;
        if (brandPresent) confidence += 0.03;
        if (distinctive) confidence += 0.02;
        weak.push({
          entity_type: c.entity_type,
          entity_id: c.entity_id,
          slug: c.slug,
          confidence: Math.min(0.75, confidence),
          method: "camera_weak_key_v0",
          matched_variant: [c.weak_key],
        });
      }

      weak.sort((a, b) => b.confidence - a.confidence);
      return weak.length > 0 ? { best: weak[0], top: weak.slice(0, 3) } : { best: null, top: [] };
    },
  };
}

function findFocalSpec(titleLower) {
  const zoomMm = titleLower.match(/\b(\d{1,3})\s*-\s*(\d{1,3})\s*mm\b/);
  if (zoomMm) return { min: Number(zoomMm[1]), max: Number(zoomMm[2]), kind: "zoom" };

  const zoomBare = titleLower.match(/\b(\d{1,3})\s*-\s*(\d{1,3})\b/);
  if (zoomBare) return { min: Number(zoomBare[1]), max: Number(zoomBare[2]), kind: "zoom" };

  const primeMm = titleLower.match(/\b(\d{1,3})\s*mm\b/);
  if (primeMm) {
    const v = Number(primeMm[1]);
    return { min: v, max: v, kind: "prime" };
  }

  return null;
}

function findApertureSpec(titleLower) {
  const varF = titleLower.match(/\bf\s*\/?\s*(\d+(?:\.\d)?)\s*-\s*(\d+(?:\.\d)?)/);
  if (varF) return { wide: Number(varF[1]), tele: Number(varF[2]) };

  const constF = titleLower.match(/\bf\s*\/?\s*(\d+(?:\.\d)?)/);
  if (constF) {
    const v = Number(constF[1]);
    return { wide: v, tele: v };
  }

  return null;
}

function parseBrandHint(titleLower, brands) {
  for (const b of brands) {
    const name = String(b.name || "").toLowerCase();
    const slug = String(b.slug || "").toLowerCase();
    if (name && titleLower.includes(name)) return slug;
    if (slug && titleLower.includes(slug.replace(/-/g, " "))) return slug;
    if (slug && titleLower.includes(slug.replace(/-/g, ""))) return slug;
  }
  return null;
}

function lensHasVersionTwo(lens) {
  const name = String(lens.display_name || "");
  return /\bmark\s*ii\b/i.test(name) || /\bii\b/.test(name);
}

function titleHasVersionTwo(titleLower) {
  return /\b(mark\s*ii|mk\s*ii|mkii|ii|2nd)\b/i.test(titleLower);
}

export function buildLensMatcher(lensModels, brands) {
  const lenses = lensModels.map((l) => ({
    entity_type: "lens_model",
    entity_id: l.lens_id,
    slug: l.slug,
    display_name: l.display_name,
    brand_slug: l.brand_slug,
    brand_name: l.brand_name,
    focal_min: Number(l.focal_length_min_mm),
    focal_max: Number(l.focal_length_max_mm),
    ap_wide: Number(l.max_aperture_wide_f),
    ap_tele: Number(l.max_aperture_tele_f),
  }));

  const brandHints = brands.map((b) => ({ slug: b.slug, name: b.name }));

  return {
    match(title) {
      const titleLower = String(title).toLowerCase();

      const focal = findFocalSpec(titleLower);
      const aperture = findApertureSpec(titleLower);
      const brandHint = parseBrandHint(titleLower, brandHints);
      const wantsV2 = titleHasVersionTwo(titleLower);

      const results = [];
      for (const l of lenses) {
        if (!focal) continue;

        const focalMatch = l.focal_min === focal.min && l.focal_max === focal.max;
        if (!focalMatch) continue;

        const apMatch =
          !aperture ||
          (Math.abs(l.ap_wide - aperture.wide) <= 0.11 && Math.abs(l.ap_tele - aperture.tele) <= 0.11);

        const brandMatch = brandHint ? l.brand_slug === brandHint : false;

        let confidence = 0.55;
        if (aperture && apMatch) confidence += 0.22;
        if (brandMatch) confidence += 0.20;

        if (wantsV2 && lensHasVersionTwo(l)) confidence += 0.03;

        results.push({
          entity_type: l.entity_type,
          entity_id: l.entity_id,
          slug: l.slug,
          confidence: Math.min(0.99, confidence),
          method: "lens_numeric_v0",
        });
      }

      results.sort((a, b) => b.confidence - a.confidence);
      return results.length > 0 ? { best: results[0], top: results.slice(0, 3) } : { best: null, top: [] };
    },
  };
}

