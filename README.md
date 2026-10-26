# Batchday

A private, single-user meal planner for Austrian grocery shopping, runnable locally or on your own Node homeserver. Choose your supermarket, preferences, pantry and schedule to get a week of recipes and one shopping list. Recipes use your ChatGPT subscription; supermarket product suggestions are optional. The interface and recipe instructions are English; generic grocery names stay German/Austrian.

## Run locally

Use Node.js 24 or newer and pnpm 12.14.0, as pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://127.0.0.1:3000**. Run commands from the repository root. A fresh checkout starts with an empty recipe collection and needs no credentials to open the app, run tests or build it.

## Connect your ChatGPT subscription

Each installation uses its owner's account through [Sign in with ChatGPT for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source). No OpenAI Platform API key or Claude/Codex installation is needed. Eligible requests use your ChatGPT plan and its limits; review the permissions and limits during sign-in.

```sh
pnpm chatgpt:login
```

Open the printed authorization link in your browser and allow ChatGPT plan usage. Then reload Batchday. The login command keeps a loopback callback open for five minutes. Check the connection with `pnpm chatgpt:login --status`; disconnect with `pnpm chatgpt:login --logout`. Use `pnpm chatgpt:login --new-account` to connect a different account; the previous connection stays active until the replacement is verified.

Credentials and a stable installation host ID are stored outside the repository in `~/.config/batchday`, with owner-only permissions. Run the login command as the same operating-system user that runs Batchday. You can set `BATCHDAY_AUTH_DIR` to a private persistent directory for a service/container; keep it outside the repository and web root. Never share that directory or bake credentials into an image. Every person cloning the repo signs in separately with their own account.

Token renewal is locked across processes. If a process crashes while holding `session.lock`, stop Batchday and any login command before removing that lock directory from the auth directory, then restart. Normal failures release the lock automatically. Keep `host-id.json` when reconnecting; a failed registration retains its issued client ID in `pending-registration.json` for the next login attempt.

Generation uses GPT-6-Luna at max reasoning when your plan lists it, otherwise the first model in your account's available model list. To choose another available model, export `BATCHDAY_MODEL=<model-slug>` in the app's environment. Check the connected account with `pnpm chatgpt:login --status` and plan usage in [ChatGPT usage settings](https://chatgpt.com/settings/usage).

### Private homeserver setup

Run Batchday as a single Node process behind your private network or an authenticated reverse proxy. Keep its catalogue and auth directory persistent. The ChatGPT connection authorizes AI usage; it does not add access control to Batchday itself.

For sign-in over SSH, run `pnpm chatgpt:login` on the server. It prints the callback port. From a second local terminal, forward that port to the server (`ssh -L <port>:127.0.0.1:<port> user@server`), then open the authorization link locally. The browser's loopback callback reaches the waiting server command through the tunnel. No callback port needs to be exposed publicly.

If signing in locally and transferring credentials instead, follow OpenAI's [self-hosted VM guide](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms): securely transfer the credential record, preserve the server's separate host ID, and let only the server refresh that transferred session. Prefer the SSH callback flow above to avoid copying credentials.

## Plan and shop

Setup has four screens: supermarket, preferences, pantry, then days/meals/servings. The five main preferences are One pot, High protein (25 g or more per serving), Keto (10 g carbs or less per serving), Low calorie (500 kcal or less per serving) and Meal prep. Diet, allergens and ingredients to avoid are available in a disclosure. Pantry starts with common staples; search finds other ingredients from saved recipes. Select only ingredients you have enough of.

**Create my week** plans a varied menu, then generates one recipe per scheduled meal, three at a time. Each recipe drops into **Week** as soon as it is ready. Swap uses matching recipes already saved; open a meal for its ingredients, method and nutrition, or to change that meal's planned servings. **Edit plan → Create new week** replaces the current plan once a menu is ready. Without a ChatGPT connection, the planner assigns saved recipes. There are no images, recipe chat or a separate recipe browser; previously saved recipes and plans remain available.

**Shopping list** adds up the week's ingredients for your portions and leaves out pantry staples. Product suggestions are optional and need a local price snapshot:

```sh
pnpm products:import
```

The import downloads the unofficial [Heisse Preise](https://github.com/badlogic/heissepreise) price dump with `curl` and keeps priced products with a known pack size for BILLA, SPAR, HOFER, Lidl and PENNY in ignored `data/products.local/products.json`. Rerun it to refresh prices. In the 2026-10-24 import, BILLA prices are current, SPAR's latest price change is from 2026-09-27, and HOFER, Lidl and PENNY have no data, so their lists stay generic.

Open **Products & prices** on Shopping to show saved matches. With a snapshot for your store, **Find BILLA products** (named after your store) matches ingredients that have no saved match yet. It needs the ChatGPT connection: one call turns ingredient names into shop search terms, code shortlists 10 products per ingredient, and a second call picks suitable products. Matches are saved, so opening the disclosure later needs no AI calls. **Choose products by** offers Cheapest, Store brand first and Organic first. Each ingredient gets one product line with packs and cost, marked "check amount" when the recipe amount cannot be compared with the pack; its menu swaps the automatic pick for another suitable product. The approximate total states how many ingredients it covers; products sold by weight without a comparable amount stay out of it. The note names the snapshot date and older store prices. **Copy list** includes product lines while the disclosure is open. Shelf prices can differ, and stock is never checked.

## Data and privacy

Generated recipes are saved in ignored `data/recipes.local/catalog.json`. Schedule, preferences, pantry, plan, shopping checks, product rule and manual product choices are saved in your browser's localStorage. Menu and recipe requests and the food lookup (ingredient names, amounts, search terms and up to 8 candidate BLS foods each) are sent to OpenAI with your installation's OAuth access token. Responses use `store: false`; Batchday saves the completed, validated recipe locally.

**Find … products** sends the store name, the names of ingredients without a saved match and up to 10 candidate products per ingredient (ID, name, pack size, price, organic flag) to OpenAI through your ChatGPT plan. Saved matches stay beside the snapshot in `data/products.local/matches.json`.

Personal catalogues, product snapshots and matches, credentials, local agent/editor configuration, logs and proof files stay out of version control. Keep them out of `public/`: everything there is served and included in builds. The app binds to loopback and has no application user authentication. This setup is for a private, single-user installation; offering a hosted service to others requires a separate access-control and provider review.

Macros are calculated in code from 2,567 [BLS 4.0](https://blsdb.de/download) groceries as bought (no ready meals, drinks or cooked variants). BLS has no dried spices apart from pepper, basil, parsley and chives, so other herbs and spices count as zero. The recipe call names each ingredient's food in search terms, code shortlists matching BLS foods, and a second small call picks one per ingredient. AI also estimates edible weights for pieces and volumes, so the results remain estimates. Missing matches or values show incomplete nutrition. Generated recipes are marked untested; dietary and allergen labels are provisional.

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

Application code and documentation are [MIT licensed](LICENSE). BLS nutrition data retains its CC BY 4.0 licence. Heisse Preise product data is downloaded locally and not included. See [THIRD_PARTY.md](THIRD_PARTY.md). Supermarket brand logos are not included.
