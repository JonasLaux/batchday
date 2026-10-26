# Third-party data and services

The MIT licence covers Batchday's application code and documentation. The following data retains its own terms.

## Nutrition data

`data/nutrition.json` contains 2,567 selected food records from:

Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0, Deutsche Nährstoffdatenbank. Karlsruhe. [DOI](https://doi.org/10.25826/Data20251217-134202-0).

The BLS data is licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). Source: [official download](https://blsdb.de/download).

Changes: selected groceries as bought (no ready meals, drinks or cooked variants), German food names and four macro columns; converted missing or nonnumeric values to `null`. Numeric nutrient values were not changed. Exact IDs, field mappings and the source checksum are in [data/nutrition-source.json](data/nutrition-source.json). `node scripts/import-nutrition.mjs` reproduces the selection.

## Supermarket product data

Optional product suggestions use a local snapshot from [Heisse Preise](https://heisse-preise.io), an unofficial Austrian grocery price search. Its code is MIT licensed ([badlogic/heissepreise](https://github.com/badlogic/heissepreise), copyright 2023 Mario Zechner). Its data is scraped from the shops' websites, is not official shop data, and comes with no stated licence. `pnpm products:import` downloads the published dump into ignored `data/products.local/`. Batchday does not include, commit, serve or redistribute that data; each installation downloads its own copy. Prices can be out of date and say nothing about availability.

## Supermarket names

Names identify shopping destinations and do not imply affiliation or availability. Product names and prices come from the snapshot above, not from the shops directly. Brand logos are not included in the public source or covered by Batchday's MIT licence.

## Model service

Recipe generation, food lookup and product matching use OpenAI models through each installation owner's ChatGPT plan ([Sign in with ChatGPT for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source)). No account, credential or model access is bundled with or licensed by this project. Requests use `store: false`; [README.md](README.md) lists what each request sends.
