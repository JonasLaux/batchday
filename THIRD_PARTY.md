# Third-party data and services

The MIT licence covers Batchday's application code and documentation. The following data retains its own terms.

## Nutrition data

`data/nutrition.json` contains 140 selected food records from:

Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0 — Deutsche Nährstoffdatenbank. Karlsruhe. [DOI](https://doi.org/10.25826/Data20251217-134202-0).

The BLS data is licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). Source: [official download](https://blsdb.de/download).

Changes: selected common groceries, German food names and four macro columns; converted missing or nonnumeric values to `null`. Numeric nutrient values were not changed. Exact IDs, field mappings and the source checksum are in [data/nutrition-source.json](data/nutrition-source.json). `node scripts/import-nutrition.mjs` reproduces the selection.

## Supermarket names

Names identify shopping destinations and do not imply affiliation, prices or availability. Brand logos are not included in the public source or covered by Batchday's MIT licence.

## Model service

Claude Code is an optional, separately installed prerequisite for generating recipes. It is not bundled or licensed by this project. Each user supplies their own authenticated CLI. Recipe requests and feedback are sent through that CLI to its configured model service.
