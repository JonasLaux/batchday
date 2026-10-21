# Batchday

A local, single-user meal planner for Austrian grocery shopping. Application code is open source under MIT; each user's recipes and plans remain local personal data.

## Current state

- TypeScript, React, TanStack Start and Vite run on Node. Recipes use a local JSON catalogue; preferences and plans use browser storage. A fresh checkout starts empty. Cloudflare Workers/D1 remain a future direction.
- Recipes are exclusively AI-generated. Explicit generation and feedback requests use the user's own authenticated Claude Code CLI with tools disabled. Recipes are marked untested until cooked; page loads never generate them.
- **Make it yours** saves a revised recipe linked to its original and feedback. Originals remain unchanged. Revising a planned meal changes only the selected slot.
- Code calculates per-serving macros from 140 selected BLS 4.0 foods. The model chooses food IDs and estimates edible weights for pieces and volumes. Missing matches, weights or nutrient values prevent a complete total; dietary and allergen labels remain provisional.
- Setup covers supermarket, preferences, cooking days, meals, portions and pantry staples. The workspace contains Recipes, This week and Shopping list.
- Weekly assignment uses existing recipes, respects preferences and meal types, and leaves unsupported slots unfilled. Creating a new week replaces the current plan; editing preferences or pantry keeps it.
- Discovery includes meal types, search, diet, cooking time, difficulty, ingredient limits, dislikes, allergens and pantry filters. The protein filter requires a calculated 25 g or more per portion.
- Shopping combines compatible generic ingredients, scales quantities and excludes selected pantry staples. Supermarket selection identifies a destination; product matching, prices and stock are absent.
- The interface and recipe prose are English. Generic German/Austrian grocery names are intentional. No multilingual framework or brand selection is planned.
- The public repository excludes personal data, credentials, local agent/editor configuration and development evidence. It includes no supermarket logos.

## Next step

Cook a generated recipe, shop from its list and use feedback to correct amounts, timing and instructions. Prioritize changes supported by that experience.

Still deferred: marking recipes cooked, recipe deletion, photos, generating an entire week through AI, daily macro targets, prices, account sync and hosted deployment. Hosting requires access control, durable storage decisions and replacing the local CLI integration.

## Verification

Domain tests cover validation, filters, meal assignment, quantity aggregation, feedback provenance and nutrient calculation. Run `pnpm test`, `pnpm typecheck` and `pnpm build` for changes to those contracts.

Local browser checks have exercised generation, recipe revision, changes to only one occurrence of a planned recipe, recalculated macros, combined shopping quantities and persistence after reload. The nutrient importer has reproduced the included snapshot from its pinned source.

Mobile layouts, browser failure paths, concurrent model requests and cooking quality still need broader hands-on verification. See [README.md](README.md) for setup and [ARCHITECTURE.md](ARCHITECTURE.md) for runtime boundaries.

## Source decisions

- **Recipes:** generated on request through the local Claude Code CLI; no scraped recipe collection is included.
- **Nutrition:** Max Rubner-Institut (2025), [BLS 4.0](https://blsdb.de/download), CC BY 4.0. The included snapshot preserves missing values and records its attribution, selected food IDs and transformations in [data/nutrition-source.json](data/nutrition-source.json).
- **Third-party material:** nutrition data keeps its own licence; application code and documentation use MIT. See [THIRD_PARTY.md](THIRD_PARTY.md).
