/**
 * utils.ts
 *
 * Shared utility functions and constants used across the app.
 */

const ASPECT_LABELS = ["9:16", "4:5", "1:1", "16:9"] as const;
const ASPECT_RATIO_VALUES: readonly number[] = [9 / 16, 4 / 5, 1, 16 / 9];

/** Max log-ratio distance from the nearest label before defaulting to "1:1". */
const ASPECT_RATIO_MAX_LOG_DISTANCE = 0.65;

/**
 * Detects the closest Bloom aspect ratio from pixel dimensions.
 * Maps to one of: "1:1", "4:5", "9:16", "16:9"
 * Uses tolerance thresholds to handle non-exact dimensions.
 * Falls back to "1:1" if no ratio matches.
 */
export function detectAspectRatio(width: number, height: number): string {
  if (
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return "1:1";
  }

  const r = width / height;
  let closest = "1:1";
  let smallest = Number.POSITIVE_INFINITY;

  for (let i = 0; i < ASPECT_LABELS.length; i++) {
    const label = ASPECT_LABELS[i];
    const ratio = ASPECT_RATIO_VALUES[i];
    if (label === undefined || ratio === undefined) {
      continue;
    }
    const delta = Math.abs(Math.log(r) - Math.log(ratio));
    if (delta < smallest) {
      smallest = delta;
      closest = label;
    }
  }

  if (smallest > ASPECT_RATIO_MAX_LOG_DISTANCE) {
    return "1:1";
  }

  return closest;
}

/**
 * Truncates a string to a max length, adding an ellipsis if needed.
 * Used for displaying prompts in the UI without overflow.
 */
export function truncate(text: string, max: number): string {
  if (max <= 0) {
    return "";
  }
  if (text.length <= max) {
    return text;
  }
  if (max <= 3) {
    return ".".repeat(max);
  }
  return `${text.slice(0, max - 3)}...`;
}

/**
 * Preset prompt templates shown in the generator view.
 * Each template has a short label and a detailed prompt.
 * Users click a template to pre-fill the prompt input.
 */
/* eslint-disable formatjs/no-literal-string-in-object -- static EN catalog; surface via intl in UI */
export const PROMPT_TEMPLATES = [
  {
    label: "Product",
    prompt:
      "Clean product photography, white background, brand colors, professional lighting",
  },
  {
    label: "Hero",
    prompt: "Wide cinematic hero banner, bold visual style, modern and striking",
  },
  {
    label: "Social",
    prompt:
      "Bold social media graphic, vibrant on-brand colors, eye-catching composition",
  },
  {
    label: "Email",
    prompt:
      "Professional email header, clean layout, warm brand tones, minimal design",
  },
  {
    label: "Sale",
    prompt:
      "Promotional sale banner, energetic and bold, brand colors, clear focal point",
  },
  {
    label: "Lifestyle",
    prompt:
      "Lifestyle photography, natural lighting, aspirational mood, brand aesthetic",
  },
] as const;
/* eslint-enable formatjs/no-literal-string-in-object */

/**
 * Aspect ratios supported by Bloom's generation API.
 * Shown as selectable pills in the generator view.
 */
export const ASPECT_RATIOS = ["1:1", "4:5", "9:16", "16:9"] as const;

/**
 * localStorage keys used for persisting user preferences.
 * Centralised here to avoid string duplication across components.
 */
export const STORAGE_KEYS = {
  API_KEY: "bloom_api_key",
  BRAND_ID: "bloom_brand_id",
  PROMPT_HISTORY: "bloom_prompt_history",
  RECENT_IMAGES: "bloom_recent_images",
} as const;
