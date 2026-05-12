/**
 * @file api.ts
 *
 * Bloom REST API client for the Canva app. All Bloom HTTP calls go through
 * this module. Base URL: https://www.trybloom.ai/api/v1 — auth via `x-api-key`.
 *
 * API docs: https://www.trybloom.ai/api/v1/docs
 */

const BLOOM_BASE = "https://www.trybloom.ai/api/v1";
const BLOOM_ORIGIN = new URL(BLOOM_BASE).origin;

/** Brand profile returned from Bloom brand endpoints. */
export interface Brand {
  id: string;
  name: string;
  url: string;
  status: string;
  brandSessionId?: string;
  brand_session_id?: string;
}

/** Generated image metadata from generation or polling endpoints. */
export interface GeneratedImage {
  id: string;
  status: "pending" | "generating" | "completed" | "failed";
  imageUrl?: string;
  url?: string;
}

/** Library image row from list images. */
export interface ImageRecord {
  id: string;
  source?: "generated" | "uploaded" | "scraped";
  status?: "pending" | "generating" | "completed" | "failed";
  actionType?: "generation" | "edit" | "resize" | "variant";
  brandSessionId?: string;
  prompt?: string;
  imageUrl?: string;
  createdAt?: string;
}

/** Options for {@link listImages}. */
export interface ListImagesOptions {
  brandSessionId?: string;
  status?: "pending" | "generating" | "completed" | "failed";
  source?: "generated" | "uploaded" | "scraped";
  actionType?: "generation" | "edit" | "resize" | "variant";
  limit?: number;
  cursor?: string;
  includeUrls?: boolean;
}

/** Error thrown when the Bloom API returns a non-success status or invalid payload. */
class BloomApiError extends Error {
  readonly status: number;
  readonly code?: string;

  /** Creates an error with HTTP status and optional Bloom error code. */
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "BloomApiError";
    this.status = status;
    this.code = code;
  }
}

/** True if `value` is a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

/** Reads the first non-empty string among several possible JSON keys. */
function readString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.length > 0) {
      return v;
    }
  }
  return undefined;
}

/** Pulls a human-readable error message from a Bloom error JSON body. */
function parseErrorBody(body: unknown): { message: string; code?: string } {
  if (!isRecord(body)) {
    return { message: "Request failed" };
  }
  const message =
    typeof body.message === "string"
      ? body.message
      : typeof body.error === "string"
        ? body.error
        : "Request failed";
  const code = typeof body.code === "string" ? body.code : undefined;
  return { message, code };
}

/**
 * Unwraps a Bloom list-brands page from JSON, supporting both `{ data: { brands } } }`
 * and `{ data: { data: { brands } } } }` response shapes.
 */
function extractBrandsPage(root: unknown): {
  brands: unknown[];
  nextCursor: string | null | undefined;
  hasMore: boolean | undefined;
} | null {
  if (!isRecord(root)) {
    return null;
  }
  const outer = root.data;
  if (!isRecord(outer)) {
    return null;
  }
  const inner = isRecord(outer.data) ? outer.data : outer;
  const brands = inner.brands;
  if (!Array.isArray(brands)) {
    return null;
  }
  const nextCursor =
    (typeof inner.nextCursor === "string" ? inner.nextCursor : null) ??
    (typeof inner.next_cursor === "string" ? inner.next_cursor : null);
  const hasMore =
    typeof inner.hasMore === "boolean"
      ? inner.hasMore
      : typeof inner.has_more === "boolean"
        ? inner.has_more
        : undefined;
  return { brands, nextCursor, hasMore };
}

/**
 * Makes an authenticated request to the Bloom API.
 * Throws a descriptive error if the response is not ok.
 */
async function bloomFetch<T>(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<T> {
  const url = path.startsWith("http")
    ? path
    : `${BLOOM_BASE}${path.startsWith("/") ? path : `/${path}`}`;

  const headers = new Headers(options.headers);
  headers.set("x-api-key", apiKey);
  if (
    options.body !== undefined &&
    !(options.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, { ...options, headers });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new BloomApiError(
      `Bloom API: response is not JSON (${response.status})`,
      response.status,
    );
  }

  if (!response.ok) {
    const { message, code } = parseErrorBody(parsed);
    throw new BloomApiError(`Bloom API ${response.status}: ${message}`, response.status, code);
  }

  if (!isRecord(parsed) || !("data" in parsed)) {
    throw new BloomApiError("Bloom API: missing data envelope in response", response.status);
  }

  return parsed.data as T;
}

/** Maps an unknown JSON object to a {@link Brand}. */
function normalizeBrand(raw: unknown): Brand {
  if (!isRecord(raw)) {
    throw new BloomApiError("Bloom API: invalid brand object", 500);
  }
  const id = readString(raw, "id") ?? "";
  const name = readString(raw, "name") ?? "";
  const url = readString(raw, "url", "brand_url", "brandUrl") ?? "";
  const status = readString(raw, "status") ?? "unknown";
  const sessionId = readString(raw, "brandSessionId", "brand_session_id") || id;
  const brand_session_id = readString(raw, "brand_session_id");

  const brand: Brand = { id, name, url, status };
  if (sessionId) {
    brand.brandSessionId = sessionId;
  }
  if (brand_session_id) {
    brand.brand_session_id = brand_session_id;
  }
  return brand;
}

/** Coerces API status strings to the {@link GeneratedImage} status union. */
function normalizeGeneratedStatus(
  raw: unknown,
): "pending" | "generating" | "completed" | "failed" {
  if (
    raw === "pending" ||
    raw === "generating" ||
    raw === "completed" ||
    raw === "failed"
  ) {
    return raw;
  }
  return "completed";
}

/** Maps a list/poll image row to {@link GeneratedImage}. */
function toGeneratedImage(row: unknown): GeneratedImage {
  if (!isRecord(row)) {
    throw new BloomApiError("Bloom API: invalid image row", 500);
  }
  const id = readString(row, "id");
  if (!id) {
    throw new BloomApiError("Bloom API: image missing id", 500);
  }
  const status = normalizeGeneratedStatus(row.status);
  const imageUrl = readString(row, "imageUrl", "image_url");
  const url = readString(row, "url");
  return { id, status, imageUrl, url };
}

/** Maps a list images row to {@link ImageRecord}. */
function toImageRecord(row: unknown): ImageRecord {
  if (!isRecord(row)) {
    return { id: "" };
  }
  const id = readString(row, "id") ?? "";
  const record: ImageRecord = { id };
  const source = row.source;
  if (source === "generated" || source === "uploaded" || source === "scraped") {
    record.source = source;
  }
  const status = row.status;
  if (
    status === "pending" ||
    status === "generating" ||
    status === "completed" ||
    status === "failed"
  ) {
    record.status = status;
  }
  const actionType = row.actionType ?? row.action_type;
  if (
    actionType === "generation" ||
    actionType === "edit" ||
    actionType === "resize" ||
    actionType === "variant"
  ) {
    record.actionType = actionType;
  }
  const bs = readString(row, "brandSessionId", "brand_session_id");
  if (bs) {
    record.brandSessionId = bs;
  }
  const prompt = readString(row, "prompt");
  if (prompt) {
    record.prompt = prompt;
  }
  const imageUrl = readString(row, "imageUrl", "image_url");
  if (imageUrl) {
    record.imageUrl = imageUrl;
  }
  const createdAt = readString(row, "createdAt", "created_at");
  if (createdAt) {
    record.createdAt = createdAt;
  }
  return record;
}

/**
 * Validates a Bloom API key by attempting to list brands.
 * Returns true if valid, false if the key is rejected.
 */
export async function validateKey(apiKey: string): Promise<boolean> {
  const qs = new URLSearchParams({ limit: "1" });
  const url = `${BLOOM_BASE}/brands?${qs.toString()}`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "x-api-key": apiKey },
    });
    if (response.status === 401 || response.status === 403) {
      return false;
    }
    if (response.ok) {
      return true;
    }
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      throw new BloomApiError(`Bloom API ${response.status}: invalid response`, response.status);
    }
    const { message, code } = parseErrorBody(parsed);
    throw new BloomApiError(`Bloom API ${response.status}: ${message}`, response.status, code);
  } catch (error) {
    if (error instanceof BloomApiError) {
      throw error;
    }
    return false;
  }
}

/**
 * Lists all brands for this API key.
 * Handles the nested response shape: data.data.brands
 */
export async function listBrands(apiKey: string): Promise<Brand[]> {
  const all: Brand[] = [];
  let cursor: string | undefined;

  for (;;) {
    const qs = new URLSearchParams({ limit: "100" });
    if (cursor) {
      qs.set("cursor", cursor);
    }

    const response = await fetch(`${BLOOM_BASE}/brands?${qs.toString()}`, {
      method: "GET",
      headers: { "x-api-key": apiKey },
    });
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      throw new BloomApiError(`Bloom API: invalid JSON (${response.status})`, response.status);
    }
    if (!response.ok) {
      const { message, code } = parseErrorBody(parsed);
      throw new BloomApiError(`Bloom API ${response.status}: ${message}`, response.status, code);
    }

    const page = extractBrandsPage(parsed);
    if (!page) {
      throw new BloomApiError("Bloom API: brands list missing or invalid", 500);
    }
    for (const item of page.brands) {
      all.push(normalizeBrand(item));
    }

    const next = page.nextCursor ?? undefined;
    if (page.hasMore === false || next == null || next === "") {
      break;
    }
    cursor = next;
  }

  return all;
}

/**
 * Starts onboarding a new brand from a website URL.
 * Returns immediately — brand status will be 'analyzing'.
 * Poll getBrand() until status is 'ready'.
 */
export async function onboardBrand(apiKey: string, url: string): Promise<Brand> {
  const data = await bloomFetch<{ id: string; status: string }>(`/brands`, apiKey, {
    method: "POST",
    body: JSON.stringify({ url }),
  });
  return {
    id: data.id,
    name: "",
    url,
    status: data.status,
    brandSessionId: data.id,
  };
}

/**
 * Gets a single brand by ID.
 * Use this to poll for onboarding completion.
 * When status is 'ready', the brand can generate images.
 */
export async function getBrand(apiKey: string, brandId: string): Promise<Brand> {
  const data = await bloomFetch<Record<string, unknown>>(
    `/brands/${encodeURIComponent(brandId)}`,
    apiKey,
    { method: "GET" },
  );
  return normalizeBrand(data);
}

/**
 * Resolves the brandSessionId from a brand object.
 * The API returns this field under different names depending
 * on the endpoint — this normalises it.
 */
export function resolveBrandSessionId(brand: Brand): string {
  return brand.brandSessionId ?? brand.brand_session_id ?? brand.id;
}

/**
 * Starts generating images using the Bloom API.
 * Returns image IDs immediately — generation is async.
 * Pass the IDs to pollImages() to wait for completion.
 *
 * @param aspectRatio - One of: "1:1" | "4:5" | "9:16" | "16:9"
 * @param variants - Number of images to generate (1-4)
 */
export async function generateImages(
  apiKey: string,
  brandSessionId: string,
  prompt: string,
  aspectRatio: string,
  variants: number,
): Promise<string[]> {
  const variantCount = Math.min(4, Math.max(1, Math.round(variants)));
  const data = await bloomFetch<{ ids?: unknown }>(`/images/generations`, apiKey, {
    method: "POST",
    body: JSON.stringify({
      prompt,
      brandSessionId,
      aspectRatio,
      variantCount,
    }),
  });
  const ids = data.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new BloomApiError("Bloom API: generation response missing ids", 500);
  }
  return ids.map((id) => {
    if (typeof id !== "string") {
      throw new BloomApiError("Bloom API: invalid image id in generation response", 500);
    }
    return id;
  });
}

/**
 * Polls the Bloom API until all images are complete.
 * Uses wait=true to hold the connection server-side.
 * Returns image objects with imageUrl populated.
 */
export async function pollImages(
  apiKey: string,
  imageIds: string[],
): Promise<GeneratedImage[]> {
  if (imageIds.length === 0) {
    return [];
  }
  if (imageIds.length > 50) {
    throw new BloomApiError("Bloom API: pollImages supports at most 50 ids", 400);
  }

  const qs = new URLSearchParams();
  qs.set("ids", imageIds.join(","));
  qs.set("wait", "true");
  qs.set("timeout", "295");

  const data = await bloomFetch<{ images?: unknown[] }>(
    `/images?${qs.toString()}`,
    apiKey,
    { method: "GET" },
  );

  if (!Array.isArray(data.images)) {
    throw new BloomApiError("Bloom API: images poll response missing images array", 500);
  }

  const byId = new Map<string, GeneratedImage>();
  for (const row of data.images) {
    const img = toGeneratedImage(row);
    byId.set(img.id, img);
  }

  for (const id of imageIds) {
    if (!byId.has(id)) {
      throw new BloomApiError(`Bloom API: poll response missing image id ${id}`, 500);
    }
  }

  return imageIds.map((id) => {
    const img = byId.get(id);
    if (!img) {
      throw new BloomApiError(`Bloom API: missing image after validation: ${id}`, 500);
    }
    return img;
  });
}

/**
 * Lists previously generated images for a brand.
 * Used for the Library tab to show past generations.
 */
export async function listImages(
  apiKey: string,
  options: ListImagesOptions = {},
): Promise<{ images: ImageRecord[]; nextCursor?: string; hasMore: boolean }> {
  const qs = new URLSearchParams();
  if (options.brandSessionId) {
    qs.set("brandSessionId", options.brandSessionId);
  }
  if (options.status) {
    qs.set("status", options.status);
  }
  if (options.source) {
    qs.set("source", options.source);
  }
  if (options.actionType) {
    qs.set("actionType", options.actionType);
  }
  if (options.limit !== undefined) {
    qs.set("limit", String(options.limit));
  }
  if (options.cursor) {
    qs.set("cursor", options.cursor);
  }
  if (options.includeUrls !== undefined) {
    qs.set("includeUrls", options.includeUrls ? "true" : "false");
  }

  const query = qs.toString();
  const path = query ? `/images?${query}` : `/images`;

  const data = await bloomFetch<{
    images?: unknown[];
    nextCursor?: string | null;
    hasMore?: boolean;
  }>(path, apiKey, { method: "GET" });

  if (!Array.isArray(data.images)) {
    throw new BloomApiError("Bloom API: list images response missing images array", 500);
  }

  const images = data.images.map(toImageRecord);
  const nextCursor = data.nextCursor ?? undefined;
  const hasMore = Boolean(data.hasMore);

  return {
    images,
    ...(nextCursor ? { nextCursor } : {}),
    hasMore,
  };
}

/**
 * Resolves an image URL from a GeneratedImage object.
 * Handles relative paths by prepending the Bloom base URL.
 */
export function getImageUrl(image: GeneratedImage): string {
  const raw = (image.imageUrl ?? image.url ?? "").trim();
  if (!raw) {
    return "";
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  if (raw.startsWith("//")) {
    return `https:${raw}`;
  }
  if (raw.startsWith("/")) {
    return `${BLOOM_ORIGIN}${raw}`;
  }
  return raw;
}

/**
 * Gets the credit balance for this API key.
 * Returns 0 on failure — never throws.
 */
export async function checkCredits(apiKey: string): Promise<number> {
  try {
    const data = await bloomFetch<{ balance: number }>(`/credits`, apiKey, { method: "GET" });
    if (typeof data.balance !== "number" || Number.isNaN(data.balance)) {
      return 0;
    }
    return data.balance;
  } catch {
    return 0;
  }
}
