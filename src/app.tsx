import type { ImageMimeType, ImageRef } from "@canva/asset";
import { upload } from "@canva/asset";
import { useFeatureSupport } from "@canva/app-hooks";
import {
  addElementAtCursor,
  addElementAtPoint,
  getDesignMetadata,
} from "@canva/design";
import type { Brand } from "./api";
import {
  checkCredits,
  generateImages,
  getBrand,
  getImageUrl,
  listBrands,
  listImages,
  onboardBrand,
  pollImages,
  resolveBrandSessionId,
  validateKey,
} from "./api";
import type { GeneratedImage } from "./api";
import { ASPECT_RATIOS, PROMPT_TEMPLATES, STORAGE_KEYS } from "./utils";
import {
  Alert,
  Badge,
  Box,
  Button,
  CharacterCountDecorator,
  FormField,
  GlobeIcon,
  Grid,
  HorizontalCard,
  ImageCard,
  LoadingIndicator,
  MultilineInput,
  Pill,
  ProgressBar,
  Rows,
  SegmentedControl,
  Text,
  TextInput,
  Title,
} from "@canva/app-ui-kit";
import { useCallback, useEffect, useRef, useState } from "react";

export type View =
  | "boot"
  | "setup"
  | "brand-select"
  | "generator"
  | "generating"
  | "results";

/** Completed generation row (used in results view). */
export interface GeneratedResult {
  id: string;
  url: string;
}

/** Library / recent image row. */
export interface RecentImage {
  id: string;
  url: string;
  createdAt?: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

/**
 * Converts an image URL to a data URL with correct MIME type.
 * Required because Canva's upload() needs a data URL, not an
 * external URL, to properly handle CORS and image format.
 */
async function toDataUrl(url: string): Promise<{ dataUrl: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch image (${res.status})`);
  }
  const headerMime =
    res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const blob = await res.blob();
  const mimeType =
    blob.type && blob.type !== "application/octet-stream"
      ? blob.type
      : headerMime || "image/jpeg";
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Could not read image as data URL"));
      }
    };
    reader.onerror = () => {
      reject(new Error("Could not read image as data URL"));
    };
    reader.readAsDataURL(blob);
  });
  return { dataUrl, mimeType };
}

function normalizeImageMimeType(raw: string): ImageMimeType {
  const allowed: ImageMimeType[] = [
    "image/jpeg",
    "image/heic",
    "image/png",
    "image/svg+xml",
    "image/webp",
    "image/tiff",
  ];
  return allowed.includes(raw as ImageMimeType)
    ? (raw as ImageMimeType)
    : "image/jpeg";
}

const MAX_ONBOARD_POLLS = 150;
const MAX_PROMPT_LEN = 500;
const MAX_HISTORY = 10;
const MAX_LIBRARY_PAGES = 8;

function brandCardTitle(brand: Brand): string {
  const n = brand.name?.trim();
  if (n) {
    return n;
  }
  const u = brand.url?.trim();
  if (u) {
    return u;
  }
  return "Brand";
}

function readPromptHistoryFromStorage(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PROMPT_HISTORY);
    if (!raw) {
      return [];
    }
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) {
      return [];
    }
    return v.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function readRecentImagesFromStorage(): RecentImage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.RECENT_IMAGES);
    if (!raw) {
      return [];
    }
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) {
      return [];
    }
    const out: RecentImage[] = [];
    for (const row of v) {
      if (typeof row !== "object" || row == null) {
        continue;
      }
      const r = row as Record<string, unknown>;
      if (typeof r.id === "string" && typeof r.url === "string") {
        out.push({
          id: r.id,
          url: r.url,
          ...(typeof r.createdAt === "string" ? { createdAt: r.createdAt } : {}),
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function persistRecentImages(images: RecentImage[]) {
  localStorage.setItem(STORAGE_KEYS.RECENT_IMAGES, JSON.stringify(images));
}

function recordToImageUrl(row: {
  id: string;
  imageUrl?: string;
  url?: string;
}): string {
  return getImageUrl({
    id: row.id,
    status: "completed",
    imageUrl: row.imageUrl,
    url: row.url,
  });
}

/* eslint-disable formatjs/no-literal-string-in-object -- static EN catalog; surface via intl in UI */
const GENERATOR_VIEW_TAB_OPTIONS: {
  value: "create" | "library";
  label: string;
}[] = [
  { value: "create", label: "Create" },
  { value: "library", label: "Library" },
];

const VARIANT_COUNT_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
];
/* eslint-enable formatjs/no-literal-string-in-object */

/* eslint-disable formatjs/no-literal-string-in-jsx -- scaffold; replace with intl when wiring copy */
export function App() {
  const [view, setView] = useState<View>("boot");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [keyError, setKeyError] = useState("");
  const [validatingKey, setValidatingKey] = useState(true);

  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null);
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [showAddBrand, setShowAddBrand] = useState(false);
  const [newBrandUrl, setNewBrandUrl] = useState("");
  const [addingBrand, setAddingBrand] = useState(false);
  const [brandError, setBrandError] = useState("");

  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<string>("1:1");
  const [variants, setVariants] = useState(2);
  const [credits, setCredits] = useState<number | null>(null);
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [promptHistory, setPromptHistory] = useState<string[]>(() =>
    readPromptHistoryFromStorage(),
  );
  const [generationError, setGenerationError] = useState("");
  const [generatorTab, setGeneratorTab] = useState<"create" | "library">(
    "create",
  );
  const [recentImages, setRecentImages] = useState<RecentImage[]>(() =>
    readRecentImagesFromStorage(),
  );
  const [loadingRecentImages, setLoadingRecentImages] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<GeneratedResult[]>([]);
  const [selectedResult, setSelectedResult] = useState("");
  const [inserting, setInserting] = useState(false);
  const [insertingImageId, setInsertingImageId] = useState("");
  const [insertError, setInsertError] = useState("");
  const [generatingContext, setGeneratingContext] = useState<{
    prompt: string;
    variants: number;
    aspectRatio: string;
  } | null>(null);

  const isMounted = useRef(true);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const isSupported = useFeatureSupport();
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (progressIntervalRef.current != null) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, []);

  /**
   * Fetches all brands for the API key.
   * If savedBrandId is provided and found in the list,
   * auto-selects it and navigates straight to the generator.
   * Otherwise shows the brand selection screen.
   */
  const loadBrands = useCallback(
    async (key: string, savedBrandId?: string): Promise<Brand[]> => {
      setLoadingBrands(true);
      setBrandError("");
      let list: Brand[] = [];
      try {
        list = await listBrands(key);
        if (!isMounted.current) {
          return list;
        }
        setBrands(list);
        if (savedBrandId !== undefined) {
          const match = list.find((b) => b.id === savedBrandId);
          if (match) {
            setSelectedBrand(match);
            setView("generator");
          } else {
            setSelectedBrand(null);
          }
        }
      } catch (e) {
        if (!isMounted.current) {
          return [];
        }
        setBrands([]);
        setSelectedBrand(null);
        setBrandError(
          e instanceof Error ? e.message : "Failed to load brands",
        );
        list = [];
      } finally {
        if (isMounted.current) {
          setLoadingBrands(false);
        }
      }
      return list;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setValidatingKey(true);
      const saved = localStorage.getItem(STORAGE_KEYS.API_KEY);
      if (!saved) {
        if (!cancelled) {
          setView("setup");
          setValidatingKey(false);
        }
        return;
      }

      const ok = await validateKey(saved);
      if (cancelled) {
        return;
      }
      if (ok) {
        setApiKey(saved);
        setApiKeyInput(saved);
        setView("brand-select");
        const savedBrandId = localStorage.getItem(STORAGE_KEYS.BRAND_ID);
        await loadBrands(saved, savedBrandId ?? undefined);
      } else {
        localStorage.removeItem(STORAGE_KEYS.API_KEY);
        localStorage.removeItem(STORAGE_KEYS.BRAND_ID);
        setView("setup");
      }
      if (!cancelled) {
        setValidatingKey(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [loadBrands]);

  const handleConnect = useCallback(async () => {
    const key = apiKeyInput.trim();
    setKeyError("");
    setValidatingKey(true);
    const ok = await validateKey(key);
    if (!isMounted.current) {
      return;
    }
    setValidatingKey(false);
    if (ok) {
      localStorage.setItem(STORAGE_KEYS.API_KEY, key);
      setApiKey(key);
      setView("brand-select");
      const savedBrandId = localStorage.getItem(STORAGE_KEYS.BRAND_ID);
      await loadBrands(key, savedBrandId ?? undefined);
    } else {
      setKeyError("Invalid API key. Get yours at trybloom.ai/developers");
    }
  }, [apiKeyInput, loadBrands]);

  /**
   * Onboards a new brand from a URL.
   * 1. Calls onboardBrand() — returns immediately
   * 2. Polls getBrand() every 2s until status is 'ready'
   * 3. Refreshes brand list
   * 4. Auto-selects the new brand
   * Shows "Learning your brand..." while polling.
   */
  const handleAddBrand = async () => {
    const url = newBrandUrl.trim();
    if (!url || !apiKey) {
      return;
    }
    setBrandError("");
    setAddingBrand(true);
    try {
      const started = await onboardBrand(apiKey, url);
      const brandId = started.id;
      let polls = 0;
      let latest = started;
      while (
        latest.status !== "ready" &&
        latest.status !== "failed" &&
        latest.status !== "logo_required" &&
        polls < MAX_ONBOARD_POLLS
      ) {
        await sleep(2000);
        if (!isMounted.current) {
          return;
        }
        latest = await getBrand(apiKey, brandId);
        polls += 1;
      }
      if (!isMounted.current) {
        return;
      }
      if (latest.status !== "ready") {
        setBrandError(
          latest.status === "logo_required"
            ? "Bloom needs a logo for this brand. Add one in trybloom.ai, then try again."
            : "Brand onboarding did not complete. Please try again.",
        );
        return;
      }
      const list = await loadBrands(apiKey, undefined);
      const found = list.find((b) => b.id === brandId) ?? latest;
      if (!isMounted.current) {
        return;
      }
      setSelectedBrand(found);
      setNewBrandUrl("");
      setShowAddBrand(false);
    } catch (e) {
      if (!isMounted.current) {
        return;
      }
      setBrandError(
        e instanceof Error ? e.message : "Could not add brand from URL",
      );
    } finally {
      if (isMounted.current) {
        setAddingBrand(false);
      }
    }
  };

  /**
   * Saves selected brand to localStorage and navigates to generator.
   */
  const handleContinue = () => {
    if (!selectedBrand) {
      return;
    }
    localStorage.setItem(STORAGE_KEYS.BRAND_ID, selectedBrand.id);
    setView("generator");
  };

  /**
   * Loads the credit balance from Bloom API and updates state.
   * Silently ignores errors — credits display is informational only.
   */
  const loadCredits = useCallback(async (key: string) => {
    try {
      const balance = await checkCredits(key);
      if (!isMounted.current) {
        return;
      }
      setCredits(balance);
    } catch {
      if (isMounted.current) {
        setCredits(null);
      }
    }
  }, []);

  /**
   * Applies a prompt template to the prompt input.
   * Sets the prompt and tracks which template is active.
   */
  const handleTemplate = useCallback((templatePrompt: string, label: string) => {
    setPrompt(templatePrompt.slice(0, MAX_PROMPT_LEN));
    setActiveTemplate(label);
  }, []);

  /**
   * Saves a prompt to history in localStorage.
   * Keeps the 10 most recent unique prompts.
   * Deduplicates so the same prompt is not stored twice.
   */
  const saveToHistory = useCallback((p: string) => {
    const t = p.trim();
    if (!t) {
      return;
    }
    setPromptHistory((prev) => {
      const next = [t, ...prev.filter((x) => x !== t)].slice(0, MAX_HISTORY);
      localStorage.setItem(STORAGE_KEYS.PROMPT_HISTORY, JSON.stringify(next));
      return next;
    });
  }, []);

  /**
   * Loads previously generated images for the Library tab.
   * Fetches completed generations for the selected brand.
   * Updates recentImages state.
   */
  const loadRecentGeneratedImages = useCallback(async () => {
    if (!apiKey || !selectedBrand) {
      return;
    }
    setLoadingRecentImages(true);
    try {
      const sessionId = resolveBrandSessionId(selectedBrand);
      const merged: RecentImage[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_LIBRARY_PAGES; page += 1) {
        const { images, nextCursor, hasMore } = await listImages(apiKey, {
          brandSessionId: sessionId,
          status: "completed",
          source: "generated",
          limit: 50,
          cursor,
        });
        for (const row of images) {
          const url = recordToImageUrl(row);
          if (!url) {
            continue;
          }
          merged.push({
            id: row.id,
            url,
            ...(row.createdAt ? { createdAt: row.createdAt } : {}),
          });
        }
        if (!hasMore || !nextCursor) {
          break;
        }
        cursor = nextCursor;
      }
      if (!isMounted.current) {
        return;
      }
      setRecentImages(merged);
      persistRecentImages(merged);
    } catch {
      if (isMounted.current) {
        setRecentImages([]);
      }
    } finally {
      if (isMounted.current) {
        setLoadingRecentImages(false);
      }
    }
  }, [apiKey, selectedBrand]);

  useEffect(() => {
    if (view === "generator" && apiKey) {
      void loadCredits(apiKey);
      void loadRecentGeneratedImages();
    }
  }, [view, apiKey, loadCredits, loadRecentGeneratedImages]);

  /**
   * Uploads a Bloom image to Canva and inserts it into the design.
   * Flow:
   *   1. Fetch image URL → convert to data URL (toDataUrl)
   *   2. Upload to Canva asset CDN via upload()
   *   3. Wait for upload: queued.whenUploaded()
   *   4. Insert into design via addElementAtCursor or addElementAtPoint
   * The upload step is required — Canva cannot insert external URLs directly.
   */
  const uploadAndInsertFromUrl = useCallback(
    async (url: string) => {
      const { dataUrl, mimeType } = await toDataUrl(url);
      const imageMime = normalizeImageMimeType(mimeType);
      const queue = await upload({
        type: "image",
        url: dataUrl,
        mimeType: imageMime,
        thumbnailUrl: dataUrl,
        aiDisclosure: "app_generated",
      });
      await queue.whenUploaded();
      const ref = queue.ref as ImageRef;
      const altText = { text: "Bloom image", decorative: false };

      if (isSupported(addElementAtPoint)) {
        const { defaultPageDimensions: dims } = await getDesignMetadata();
        if (dims) {
          const width = Math.min(480, dims.width * 0.45);
          const height = Math.min(480, dims.height * 0.45);
          await addElementAtPoint({
            type: "image",
            ref,
            altText,
            top: Math.max(0, (dims.height - height) / 2),
            left: Math.max(0, (dims.width - width) / 2),
            width,
            height,
          });
          return;
        }
      }
      if (isSupported(addElementAtCursor)) {
        await addElementAtCursor({
          type: "image",
          ref,
          altText,
        });
        return;
      }
      if (isSupported(addElementAtPoint)) {
        await addElementAtPoint({
          type: "image",
          ref,
          altText,
          top: 80,
          left: 80,
          width: 400,
          height: 400,
        });
        return;
      }
      throw new Error("Adding images is not supported here");
    },
    [isSupported],
  );

  /**
   * Main generation flow:
   * 1. Save prompt to history
   * 2. Show generating view with progress bar
   * 3. Call generateImages() to get image IDs
   * 4. Start progress animation (increments 3% per second up to 90%)
   * 5. Call pollImages() — waits for all images to complete
   * 6. Set progress to 100%
   * 7. Map results to { id, url } array
   * 8. Show results view
   * On error: show error alert, return to generator view
   */
  const handleGenerate = async () => {
    if (!apiKey || !selectedBrand || !prompt.trim() || generating) {
      return;
    }

    const trimmed = prompt.trim();

    const startProgressTick = () => {
      if (progressIntervalRef.current != null) {
        clearInterval(progressIntervalRef.current);
      }
      progressIntervalRef.current = setInterval(() => {
        setProgress((p) => Math.min(90, p + 3));
      }, 1000);
    };

    const stopProgressTick = () => {
      if (progressIntervalRef.current != null) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };

    setGenerationError("");
    saveToHistory(trimmed);
    setGeneratingContext({
      prompt: trimmed,
      variants,
      aspectRatio,
    });
    setProgress(0);
    setView("generating");
    setGenerating(true);

    try {
      const sessionId = resolveBrandSessionId(selectedBrand);
      const ids = await generateImages(
        apiKey,
        sessionId,
        trimmed,
        aspectRatio,
        variants,
      );
      startProgressTick();
      const done = await pollImages(apiKey, ids);
      stopProgressTick();
      if (!isMounted.current) {
        return;
      }
      setProgress(100);
      const mapped: GeneratedResult[] = done
        .map((img: GeneratedImage) => ({
          id: img.id,
          url: getImageUrl(img),
        }))
        .filter((r) => Boolean(r.url));
      if (mapped.length === 0) {
        throw new Error("No completed image URLs returned");
      }
      const recentMapped: RecentImage[] = mapped.map((r) => ({
        id: r.id,
        url: r.url,
      }));
      setRecentImages((prev) => {
        const byId = new Map(prev.map((r) => [r.id, r]));
        for (const r of recentMapped) {
          byId.set(r.id, r);
        }
        const next = [...byId.values()].slice(0, 100);
        persistRecentImages(next);
        return next;
      });
      void loadRecentGeneratedImages();
      setResults(mapped);
      setSelectedResult(mapped[0]?.id ?? "");
      setInsertError("");
      setView("results");
    } catch (e) {
      stopProgressTick();
      if (!isMounted.current) {
        return;
      }
      setGenerationError(
        e instanceof Error ? e.message : "Generation failed",
      );
      setResults([]);
      setSelectedResult("");
      setView("generator");
    } finally {
      stopProgressTick();
      if (isMounted.current) {
        setGenerating(false);
        setGeneratingContext(null);
      }
    }
  };

  /**
   * Inserts the selected result image into the Canva design.
   * After success: returns to generator, refreshes credits and library.
   */
  const handleInsert = async () => {
    const hit = results.find((r) => r.id === selectedResult);
    if (hit == null || !hit.url) {
      setInsertError("Select an image to add");
      return;
    }
    setInsertError("");
    setInserting(true);
    try {
      await uploadAndInsertFromUrl(hit.url);
      if (!isMounted.current) {
        return;
      }
      setView("generator");
      setResults([]);
      setSelectedResult("");
      setProgress(0);
      if (apiKey) {
        void loadCredits(apiKey);
        void loadRecentGeneratedImages();
      }
    } catch (e) {
      if (!isMounted.current) {
        return;
      }
      setInsertError(e instanceof Error ? e.message : "Insert failed");
    } finally {
      if (isMounted.current) {
        setInserting(false);
      }
    }
  };

  /**
   * Inserts a specific image from the library into the design.
   * Used for the Library tab "Add" button.
   */
  const handleInsertSpecificRecentImage = async (image: RecentImage) => {
    setInsertError("");
    setInsertingImageId(image.id);
    try {
      await uploadAndInsertFromUrl(image.url);
    } catch (e) {
      if (isMounted.current) {
        setInsertError(e instanceof Error ? e.message : "Insert failed");
      }
    } finally {
      if (isMounted.current) {
        setInsertingImageId("");
      }
    }
  };

  if (view === "boot" && validatingKey) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        height="full"
        padding="2u"
      >
        <LoadingIndicator size="medium" />
      </Box>
    );
  }

  if (view === "setup") {
    return (
      <Box padding="2u">
        <Rows spacing="2u">
          <Title size="medium">Connect your Bloom account</Title>
          <Text tone="secondary" size="medium">
            Generate on-brand images directly inside Canva
          </Text>
          <FormField
            label="API key"
            description="Get your key at trybloom.ai/developers"
            value={apiKeyInput}
            control={(field) => (
              <TextInput
                id={field.id}
                error={Boolean(keyError) || field.error}
                value={apiKeyInput}
                onChange={setApiKeyInput}
                placeholder="bloom_sk_..."
                disabled={validatingKey}
              />
            )}
          />
          {keyError ? (
            <Alert tone="critical" title="Error">
              {keyError}
            </Alert>
          ) : null}
          <Button
            variant="primary"
            stretch
            loading={validatingKey}
            disabled={validatingKey}
            onClick={() => {
              void handleConnect();
            }}
          >
            Connect
          </Button>
        </Rows>
      </Box>
    );
  }

  if (view === "brand-select") {
    return (
      <Box padding="2u">
        <Rows spacing="2u">
          <Title size="medium">Select your Brand</Title>
          {brandError && !showAddBrand ? (
            <Text tone="critical" size="small">
              {brandError}
            </Text>
          ) : null}
          {loadingBrands ? (
            <Box display="flex" justifyContent="center" paddingY="2u">
              <LoadingIndicator size="medium" />
            </Box>
          ) : (
            <Rows spacing="1u">
              {brands.map((brand) => (
                <HorizontalCard
                  key={brand.id}
                  title={brandCardTitle(brand)}
                  description={brand.url || " "}
                  ariaLabel={`Select brand ${brandCardTitle(brand)}`}
                  thumbnail={{ icon: () => GlobeIcon() }}
                  bottomEnd={
                    selectedBrand?.id === brand.id ? (
                      <Badge
                        tone="positive"
                        text="Selected"
                        ariaLabel="Selected brand"
                      />
                    ) : undefined
                  }
                  bottomEndVisibility="always"
                  onClick={() => {
                    setSelectedBrand(brand);
                  }}
                />
              ))}
            </Rows>
          )}
          <Button
            variant="secondary"
            type="button"
            stretch
            onClick={() => {
              setShowAddBrand((v) => !v);
              setBrandError("");
            }}
          >
            Add brand from URL
          </Button>
          {showAddBrand ? (
            <Rows spacing="1u">
              <FormField
                label="Website URL"
                value={newBrandUrl}
                control={(field) => (
                  <TextInput
                    id={field.id}
                    error={Boolean(brandError) || field.error}
                    value={newBrandUrl}
                    onChange={setNewBrandUrl}
                    placeholder="https://example.com"
                    disabled={addingBrand}
                  />
                )}
              />
              {brandError && showAddBrand ? (
                <Text tone="critical" size="small">
                  {brandError}
                </Text>
              ) : null}
              <Button
                variant="secondary"
                type="button"
                stretch
                loading={addingBrand}
                disabled={addingBrand || !newBrandUrl.trim()}
                onClick={() => {
                  void handleAddBrand();
                }}
              >
                {addingBrand ? "Learning your brand..." : "Add Brand"}
              </Button>
            </Rows>
          ) : null}
          <Button
            variant="primary"
            type="button"
            stretch
            disabled={!selectedBrand}
            onClick={handleContinue}
          >
            Continue →
          </Button>
        </Rows>
      </Box>
    );
  }

  if (view === "generating") {
    const meta = generatingContext;
    const promptLine =
      meta && meta.prompt.length > 50
        ? `${meta.prompt.slice(0, 50)}…`
        : (meta?.prompt ?? "");
    return (
      <Box padding="2u">
        <Rows spacing="2u">
          <Title size="medium">Generating your images…</Title>
          <ProgressBar
            value={Math.min(100, Math.round(progress))}
            ariaLabel="Generation progress"
          />
          {meta ? (
            <>
              <Text tone="secondary" size="small">
                {promptLine}
              </Text>
              <Text tone="secondary" size="xsmall">
                {`${meta.variants} variants · ${meta.aspectRatio}`}
              </Text>
            </>
          ) : null}
          {generationError ? (
            <Alert tone="critical" title="Generation error">
              {generationError}
            </Alert>
          ) : null}
        </Rows>
      </Box>
    );
  }

  if (view === "results") {
    const count = results.length;
    return (
      <Box padding="2u">
        <Rows spacing="2u">
          <Button
            variant="tertiary"
            type="button"
            onClick={() => {
              setView("generator");
              setResults([]);
              setSelectedResult("");
              setInsertError("");
              setProgress(0);
            }}
          >
            ← Back
          </Button>
          <Title size="medium">{`${count} images ready`}</Title>
          <Grid columns={2} spacing="1u">
            {results.map((r) => (
              <ImageCard
                key={r.id}
                thumbnailUrl={r.url}
                alt="Generated result"
                ariaLabel="Select image"
                borderRadius="standard"
                selectable
                selected={selectedResult === r.id}
                onClick={() => {
                  setInsertError("");
                  setSelectedResult(r.id);
                }}
              />
            ))}
          </Grid>
          <Text tone="secondary" size="small">
            Click to select, then add to your design
          </Text>
          {insertError ? (
            <Alert tone="critical" title="Insert error">
              {insertError}
            </Alert>
          ) : null}
          <Button
            variant="primary"
            type="button"
            stretch
            loading={inserting}
            disabled={inserting || !selectedResult}
            onClick={() => {
              void handleInsert();
            }}
          >
            Add to design ↓
          </Button>
          <Button
            variant="secondary"
            type="button"
            stretch
            disabled={inserting || generating}
            onClick={() => {
              void handleGenerate();
            }}
          >
            Regenerate
          </Button>
        </Rows>
      </Box>
    );
  }

  if (view === "generator") {
    const brandLabel = selectedBrand
      ? brandCardTitle(selectedBrand)
      : "No brand";
    const creditsLabel =
      credits == null ? "—" : credits === 1 ? "1 credit" : `${credits} credits`;

    return (
      <Box padding="2u">
        <Rows spacing="2u">
          <SegmentedControl<"create" | "library">
            value={generatorTab}
            onChange={(v) => {
              setGeneratorTab(v);
            }}
            options={GENERATOR_VIEW_TAB_OPTIONS}
          />

          {generatorTab === "create" ? (
            <Rows spacing="2u">
              <Box
                padding="2u"
                borderRadius="standard"
                border="control"
                background="elevationSurfaceSunken"
              >
                <Rows spacing="0.5u">
                  <Text size="small" variant="bold">
                    {brandLabel}
                  </Text>
                  <Text tone="secondary" size="small">
                    {`Balance: ${creditsLabel}`}
                  </Text>
                </Rows>
              </Box>

              <Box display="flex" flexWrap="wrap">
                {PROMPT_TEMPLATES.map((t) => (
                  <Box key={t.label} paddingEnd="0.5u" paddingBottom="0.5u">
                    <Pill
                      text={t.label}
                      role="switch"
                      selected={activeTemplate === t.label}
                      onClick={() => {
                        handleTemplate(t.prompt, t.label);
                      }}
                    />
                  </Box>
                ))}
              </Box>

              <FormField
                label="Prompt"
                value={prompt}
                control={(field) => (
                  <MultilineInput
                    id={field.id}
                    error={field.error}
                    value={prompt}
                    maxLength={MAX_PROMPT_LEN}
                    minRows={3}
                    autoGrow
                    placeholder="Describe the image you want…"
                    onChange={(v) => {
                      setPrompt(v.slice(0, MAX_PROMPT_LEN));
                      setActiveTemplate(null);
                    }}
                    footer={<CharacterCountDecorator max={MAX_PROMPT_LEN} />}
                  />
                )}
              />

              {promptHistory.length > 0 ? (
                <Rows spacing="0.5u">
                  <Text size="xsmall" tone="secondary">
                    Recent prompts
                  </Text>
                  <Box display="flex" flexWrap="wrap">
                    {promptHistory.slice(0, 5).map((p) => (
                      <Box key={p} paddingEnd="0.5u" paddingBottom="0.5u">
                        <Pill
                          text={p.length > 40 ? `${p.slice(0, 37)}…` : p}
                          ariaLabel={p}
                          onClick={() => {
                            setPrompt(p.slice(0, MAX_PROMPT_LEN));
                            setActiveTemplate(null);
                          }}
                        />
                      </Box>
                    ))}
                  </Box>
                </Rows>
              ) : null}

              <Text size="xsmall" tone="secondary">
                Aspect ratio
              </Text>
              <Box display="flex" flexWrap="wrap">
                {ASPECT_RATIOS.map((r) => (
                  <Box key={r} paddingEnd="0.5u" paddingBottom="0.5u">
                    <Pill
                      text={r}
                      role="switch"
                      selected={aspectRatio === r}
                      onClick={() => {
                        setAspectRatio(r);
                      }}
                    />
                  </Box>
                ))}
              </Box>

              <Text size="xsmall" tone="secondary">
                Variants
              </Text>
              <SegmentedControl<number>
                value={variants}
                onChange={(v) => {
                  setVariants(v);
                }}
                options={VARIANT_COUNT_OPTIONS}
              />

              {generationError ? (
                <Alert tone="critical" title="Generation error">
                  {generationError}
                </Alert>
              ) : null}

              <Button
                variant="primary"
                type="button"
                stretch
                loading={generating}
                disabled={
                  generating ||
                  !prompt.trim() ||
                  !selectedBrand
                }
                onClick={() => {
                  void handleGenerate();
                }}
              >
                Generate new images
              </Button>
            </Rows>
          ) : (
            <Rows spacing="2u">
              <Box display="flex" justifyContent="spaceBetween" alignItems="center">
                <Text size="medium" variant="bold">
                  Already generated images
                </Text>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => {
                    void loadRecentGeneratedImages();
                  }}
                >
                  Refresh
                </Button>
              </Box>
              {insertError ? (
                <Alert tone="critical" title="Insert error">
                  {insertError}
                </Alert>
              ) : null}
              {loadingRecentImages ? (
                <Box display="flex" justifyContent="center" paddingY="2u">
                  <LoadingIndicator size="medium" />
                </Box>
              ) : recentImages.length === 0 ? (
                <Text tone="secondary" size="small">
                  No images yet. Generate from the Create tab.
                </Text>
              ) : (
                <Grid columns={2} spacing="1u">
                  {recentImages.map((img) => (
                    <ImageCard
                      key={img.id}
                      thumbnailUrl={img.url}
                      alt="Generated image"
                      ariaLabel="Add image to design"
                      borderRadius="standard"
                      loading={insertingImageId === img.id}
                      onClick={() => {
                        void handleInsertSpecificRecentImage(img);
                      }}
                    />
                  ))}
                </Grid>
              )}
            </Rows>
          )}
        </Rows>
      </Box>
    );
  }

  return (
    <Box padding="2u">
      <Text tone="secondary" size="small">
        {`View "${view}" — coming soon.`}
      </Text>
    </Box>
  );
}
/* eslint-enable formatjs/no-literal-string-in-jsx */
