# Batchday

A local meal planner for Austrian grocery shopping. Generate recipes, adjust them with feedback, plan the week and combine ingredients into a shopping list. The interface and recipe instructions are English; generic grocery names stay German/Austrian.

## Run locally

Use Node.js 24 or newer and pnpm 12.14.0, as pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://127.0.0.1:3000**. Run commands from the repository root. A fresh checkout starts with an empty recipe collection and needs no credentials to open the app, run tests or build it.

To generate or revise recipes, install Claude Code and sign in with your own account using the [official quickstart](https://code.claude.com/docs/en/quickstart). The `claude` command must be available on the server's `PATH`. Batchday uses Haiku with tools disabled; authentication belongs to your CLI installation, and no credentials are bundled with this project. Requests use your own model access and its usage limits.

In **Recipes**, describe a dish and choose **Generate recipe**. Open a recipe and use **Make it yours** to change ingredients or amounts. Each revision saves a new version, preserving the original; editing a planned meal updates that meal's slot. The week planner assigns recipes already in your collection.

## Data and privacy

Generated recipes are saved in ignored `data/recipes.local/catalog.json`. Schedule, preferences, pantry, plan and shopping checks are saved in your browser's localStorage. Recipe requests and feedback, including the recipe being revised, are sent through your authenticated CLI to its model service.

Personal catalogues, credentials, local agent/editor configuration, logs and proof files are excluded from version control. Keep them out of `public/`: everything there is served and included in builds. The app binds to loopback and has no user authentication; public hosting needs access control and a different model integration.

Macros are calculated in code from 140 selected [BLS 4.0](https://blsdb.de/download) foods. AI chooses food matches and estimates edible weights for pieces and volumes, so the results remain estimates. Missing matches or values show incomplete nutrition. Generated recipes are marked untested; dietary and allergen labels are provisional. Supermarket selection does not provide prices or stock.

The nutrient snapshot is included and needs no network at runtime. `node scripts/import-nutrition.mjs` reproduces it from the official download using `curl` and `unzip`. Attribution, selected IDs and the source checksum are in [data/nutrition-source.json](data/nutrition-source.json).

## Contributing

Keep changes focused and add a meaningful test for new domain behavior. Before submitting changes, run:

```sh
pnpm test
pnpm typecheck
pnpm build
```

For behavior changes, also check the affected flow in the app. `pnpm preview` serves a production build locally; `pnpm generate-routes` regenerates the route tree after route changes.

See [PRODUCT.md](PRODUCT.md) for current scope and next steps, and [ARCHITECTURE.md](ARCHITECTURE.md) for code and storage boundaries. The active runtime is Node, JSON and browser storage. Cloudflare packages and `wrangler.jsonc` are retained scaffold for a later hosting direction; D1/R2 are not connected.

## Licence

Application code and documentation are [MIT licensed](LICENSE). BLS nutrition data retains its CC BY 4.0 licence; see [THIRD_PARTY.md](THIRD_PARTY.md). Supermarket brand logos are not included.
