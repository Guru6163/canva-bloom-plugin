import type { Brand } from "./api";
import {
  getBrand,
  listBrands,
  onboardBrand,
  validateKey,
} from "./api";
import { ASPECT_RATIOS, STORAGE_KEYS } from "./utils";
import {
  Alert,
  Badge,
  Box,
  Button,
  FormField,
  GlobeIcon,
  HorizontalCard,
  LoadingIndicator,
  Rows,
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

const MAX_ONBOARD_POLLS = 150;

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

  const [prompt, _setPrompt] = useState("");
  const [aspectRatio, _setAspectRatio] = useState<string>(ASPECT_RATIOS[0]);
  const [generationIds, _setGenerationIds] = useState<string[]>([]);
  const [results, _setResults] = useState<GeneratedResult[]>([]);
  const [recentImages, _setRecentImages] = useState<RecentImage[]>([]);

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
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
   * Clears all stored data and returns to setup.
   * Called when user wants to change their API key.
   */
  const handleReset = () => {
    localStorage.removeItem(STORAGE_KEYS.API_KEY);
    localStorage.removeItem(STORAGE_KEYS.BRAND_ID);
    localStorage.removeItem(STORAGE_KEYS.PROMPT_HISTORY);
    localStorage.removeItem(STORAGE_KEYS.RECENT_IMAGES);
    setApiKey("");
    setApiKeyInput("");
    setBrands([]);
    setSelectedBrand(null);
    setShowAddBrand(false);
    setNewBrandUrl("");
    setBrandError("");
    setKeyError("");
    setView("setup");
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
          <Box display="flex" justifyContent="start">
            <Button variant="tertiary" type="button" onClick={handleReset}>
              Reset
            </Button>
          </Box>
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

  return (
    <Box padding="2u">
      <Text tone="secondary" size="small">
        {`View "${view}" — coming soon.`}
      </Text>
      <Text size="xsmall" tone="tertiary">
        {`Reserved: ${selectedBrand?.id ?? "no brand"}, prompt ${prompt.length} chars, ${aspectRatio}, ${generationIds.length} job(s), ${results.length} result(s), ${recentImages.length} recent.`}
      </Text>
    </Box>
  );
}
/* eslint-enable formatjs/no-literal-string-in-jsx */
