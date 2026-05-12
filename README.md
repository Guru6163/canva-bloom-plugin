# Bloom for Canva

Generate on-brand images inside Canva using the Bloom API.
Connect your Bloom brand once — then generate, select,
and add images directly to any Canva design.

## Features

- Generate on-brand images from any text prompt
- 6 preset templates for common use cases
- Select aspect ratio: 1:1, 4:5, 9:16, 16:9
- Generate 1-4 variants at once
- Library tab for browsing previously generated images
- Add to design in one click

## How it works

1. Connect your Bloom API key
2. Select your brand
3. Describe what you want to generate
4. Click Generate
5. Select an image and click "Add to design"

## Setup for development

### Prerequisites

- Node.js 18+
- Canva Developer account

### Install

```bash
npm install
```

### Run locally

```bash
npm start
```

App runs at https://localhost:8080

### Load in Canva

1. Go to [canva.com/developers](https://www.canva.com/developers/apps)
2. Create a new app
3. Set Development URL to https://localhost:8080
4. Click Preview

## Project structure

| Path | Role |
|------|------|
| `src/index.tsx` | Registers the design editor intent with `@canva/intents` |
| `src/intents/design_editor/index.tsx` | React root, App UI Kit / i18n providers, global styles |
| `src/app.tsx` | All app state and view rendering |
| `src/api.ts` | Bloom REST API client |
| `src/utils.ts` | Utilities, constants, prompt templates |
| `src/styles.css` | Component styles |

## Architecture note

Canva apps run as an iframe inside the Canva editor.
All Bloom API calls happen directly from the browser.
Images are fetched, converted to data URLs, uploaded
to Canva's CDN, then inserted into the design.

## Get your Bloom API key

[trybloom.ai/developers](https://www.trybloom.ai/developers)
