# Seed Data

This directory contains the initial crop database for OpenHarvest, seeded from OpenFarm's CC0 (Public Domain) dataset.

## License

All data in this directory is licensed **CC0 1.0 Universal (Public Domain Dedication)**.

This means you can copy, modify, distribute, and use the data for any purpose — commercial or non-commercial — without asking permission.

Original source: [OpenFarm](https://github.com/openfarmcc/OpenFarm) (archived April 2025)

## Contents

| File | Description |
|---|---|
| `crops.json` | Core crop data (name, growing requirements, timing, spacing) |
| `plant_problems.json` | Common plant problems, symptoms, and organic treatments |
| `companion_planting.json` | Companion planting relationships (beneficial and antagonistic) |
| `crop_tags.json` | Tag taxonomy (vegetable, herb, fruit, flower, etc.) |

## Data Quality Notes

- OpenFarm data was community-contributed and varied in completeness
- Fields may be null or approximate — contributions to improve accuracy are welcome
- Scientific names have been verified against USDA PLANTS Database where possible
- Frost timing data (WeeksBeforeLastFrost, WeeksAfterLastFrost) is based on USDA zone averages

## Contributing Crop Data

If you find an error or want to add a crop:

1. Edit the relevant JSON file
2. Include a source for your data (university extension, RHS, USDA, etc.)
3. Open a pull request with the `data` label

## Importing / Re-seeding

The data is automatically imported during `dotnet ef database update` via EF Core seed data.

To re-seed a running database:

```bash
dotnet run --project src/OpenHarvest.API -- seed
```

## Data Sources

- [OpenFarm GitHub (Archived)](https://github.com/openfarmcc/OpenFarm)
- [USDA PLANTS Database](https://plants.usda.gov/)
- [RHS Plant Finder](https://www.rhs.org.uk/plants)
- University Cooperative Extension Services (various states)
