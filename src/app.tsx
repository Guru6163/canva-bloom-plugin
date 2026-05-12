import type { Brand } from "./api";
import { validateKey } from "./api";
import { ASPECT_RATIOS, STORAGE_KEYS } from "./utils";
import {
  Alert,
  Box,
  Button,
  FormField,
  LoadingIndicator,
  Rows,
  Text,
  TextInput,
  Title,
} from "@canva/app-ui-kit";
import { useCallback, useEffect, useState } from "react";

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

/**
 * Root app shell. Setup flow state: `view`, `apiKey`, `apiKeyInput`, `keyError`, `validatingKey`.
 * Upcoming views will add: selected brand, prompt, aspect ratio, generation ids, {@link GeneratedResult}, {@link RecentImage}.
 */

/* eslint-disable formatjs/no-literal-string-in-jsx -- scaffold; replace with intl when wiring copy */
export function App() {
  const [view, setView] = useState<View>("boot");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [keyError, setKeyError] = useState("");
  const [validatingKey, setValidatingKey] = useState(true);

  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, _setSelectedBrandId] = useState<string | null>(null);
  const [prompt, _setPrompt] = useState("");
  const [aspectRatio, _setAspectRatio] = useState<string>(ASPECT_RATIOS[0]);
  const [generationIds, _setGenerationIds] = useState<string[]>([]);
  const [results, _setResults] = useState<GeneratedResult[]>([]);
  const [recentImages, _setRecentImages] = useState<RecentImage[]>([]);

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
        setBrands([]);
        setView("brand-select");
      } else {
        localStorage.removeItem(STORAGE_KEYS.API_KEY);
        setView("setup");
      }
      setValidatingKey(false);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleConnect = useCallback(async () => {
    const key = apiKeyInput.trim();
    setKeyError("");
    setValidatingKey(true);
    const ok = await validateKey(key);
    setValidatingKey(false);
    if (ok) {
      localStorage.setItem(STORAGE_KEYS.API_KEY, key);
      setApiKey(key);
      setBrands([]);
      setView("brand-select");
    } else {
      setKeyError("Invalid API key. Get yours at trybloom.ai/developers");
    }
  }, [apiKeyInput]);

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
        <Rows spacing="1u">
          <Title size="small">Brand select</Title>
          <Text size="small" tone="secondary">
            {apiKey
              ? `Signed in. ${brands.length} brand(s).`
              : `${brands.length} brand(s).`}
          </Text>
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
        {`Reserved: brand ${selectedBrandId ?? "—"}, prompt ${prompt.length} chars, ${aspectRatio}, ${generationIds.length} job(s), ${results.length} result(s), ${recentImages.length} recent.`}
      </Text>
    </Box>
  );
}
/* eslint-enable formatjs/no-literal-string-in-jsx */
