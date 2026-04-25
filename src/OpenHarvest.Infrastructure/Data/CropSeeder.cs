using OpenHarvest.Domain.Entities;

namespace OpenHarvest.Infrastructure.Data;

/// <summary>
/// Phase 1 seed: a small starter catalog of common crops so the autocomplete works
/// before the full OpenFarm CC0 sync lands. Idempotent — only seeds when the table
/// is empty. Replaced by the worker's nightly sync once Phase 5 federation work
/// brings in the upstream catalog.
/// </summary>
public static class CropSeeder
{
    public static async Task SeedAsync(OpenHarvestDbContext db, CancellationToken ct = default)
    {
        if (db.Crops.Any()) return;

        var now = DateTime.UtcNow;
        var crops = new List<Crop>
        {
            C("brandywine-tomato", "Brandywine Tomato", "Solanum lycopersicum", new[] { "vegetable", "fruit" }, daysToMaturity: 80, plantSpacing: 36),
            C("cherokee-purple-tomato", "Cherokee Purple Tomato", "Solanum lycopersicum", new[] { "vegetable", "fruit" }, daysToMaturity: 80, plantSpacing: 36),
            C("sungold-tomato", "Sungold Tomato", "Solanum lycopersicum", new[] { "vegetable", "fruit" }, daysToMaturity: 65, plantSpacing: 24),
            C("roma-tomato", "Roma Tomato", "Solanum lycopersicum", new[] { "vegetable", "fruit" }, daysToMaturity: 75, plantSpacing: 24),
            C("cherry-tomato", "Cherry Tomato", "Solanum lycopersicum", new[] { "vegetable", "fruit" }, daysToMaturity: 65, plantSpacing: 24),
            C("bell-pepper", "Bell Pepper", "Capsicum annuum", new[] { "vegetable" }, daysToMaturity: 70, plantSpacing: 18),
            C("jalapeno", "Jalapeño Pepper", "Capsicum annuum", new[] { "vegetable" }, daysToMaturity: 70, plantSpacing: 18),
            C("habanero", "Habanero Pepper", "Capsicum chinense", new[] { "vegetable" }, daysToMaturity: 90, plantSpacing: 18),
            C("cucumber", "Cucumber", "Cucumis sativus", new[] { "vegetable", "fruit" }, daysToMaturity: 55, plantSpacing: 12, canDirectSow: true),
            C("zucchini", "Zucchini", "Cucurbita pepo", new[] { "vegetable" }, daysToMaturity: 55, plantSpacing: 24, canDirectSow: true),
            C("yellow-squash", "Yellow Squash", "Cucurbita pepo", new[] { "vegetable" }, daysToMaturity: 55, plantSpacing: 24, canDirectSow: true),
            C("butternut-squash", "Butternut Squash", "Cucurbita moschata", new[] { "vegetable" }, daysToMaturity: 110, plantSpacing: 24, canDirectSow: true),
            C("pumpkin", "Pumpkin", "Cucurbita pepo", new[] { "vegetable" }, daysToMaturity: 100, plantSpacing: 60, canDirectSow: true),
            C("watermelon", "Watermelon", "Citrullus lanatus", new[] { "fruit" }, daysToMaturity: 90, plantSpacing: 36, canDirectSow: true),
            C("cantaloupe", "Cantaloupe", "Cucumis melo", new[] { "fruit" }, daysToMaturity: 80, plantSpacing: 36, canDirectSow: true),
            C("carrot", "Carrot", "Daucus carota", new[] { "vegetable", "root" }, daysToMaturity: 70, plantSpacing: 3, canDirectSow: true),
            C("beet", "Beet", "Beta vulgaris", new[] { "vegetable", "root" }, daysToMaturity: 60, plantSpacing: 4, canDirectSow: true),
            C("radish", "Radish", "Raphanus sativus", new[] { "vegetable", "root" }, daysToMaturity: 30, plantSpacing: 2, canDirectSow: true),
            C("turnip", "Turnip", "Brassica rapa", new[] { "vegetable", "root" }, daysToMaturity: 50, plantSpacing: 4, canDirectSow: true),
            C("onion", "Onion", "Allium cepa", new[] { "vegetable" }, daysToMaturity: 100, plantSpacing: 4),
            C("garlic", "Garlic", "Allium sativum", new[] { "vegetable", "herb" }, daysToMaturity: 240, plantSpacing: 6),
            C("scallion", "Scallion", "Allium fistulosum", new[] { "vegetable" }, daysToMaturity: 60, plantSpacing: 2, canDirectSow: true),
            C("leek", "Leek", "Allium ampeloprasum", new[] { "vegetable" }, daysToMaturity: 100, plantSpacing: 6),
            C("lettuce", "Lettuce", "Lactuca sativa", new[] { "vegetable", "leafy-green" }, daysToMaturity: 50, plantSpacing: 8, canDirectSow: true),
            C("spinach", "Spinach", "Spinacia oleracea", new[] { "vegetable", "leafy-green" }, daysToMaturity: 45, plantSpacing: 4, canDirectSow: true),
            C("kale", "Kale", "Brassica oleracea", new[] { "vegetable", "leafy-green" }, daysToMaturity: 60, plantSpacing: 18),
            C("swiss-chard", "Swiss Chard", "Beta vulgaris", new[] { "vegetable", "leafy-green" }, daysToMaturity: 60, plantSpacing: 12, canDirectSow: true),
            C("arugula", "Arugula", "Eruca sativa", new[] { "vegetable", "leafy-green" }, daysToMaturity: 40, plantSpacing: 4, canDirectSow: true),
            C("broccoli", "Broccoli", "Brassica oleracea", new[] { "vegetable" }, daysToMaturity: 75, plantSpacing: 18),
            C("cauliflower", "Cauliflower", "Brassica oleracea", new[] { "vegetable" }, daysToMaturity: 80, plantSpacing: 18),
            C("brussels-sprouts", "Brussels Sprouts", "Brassica oleracea", new[] { "vegetable" }, daysToMaturity: 100, plantSpacing: 24),
            C("cabbage", "Cabbage", "Brassica oleracea", new[] { "vegetable" }, daysToMaturity: 80, plantSpacing: 18),
            C("green-bean", "Green Bean", "Phaseolus vulgaris", new[] { "vegetable", "legume" }, daysToMaturity: 60, plantSpacing: 4, canDirectSow: true),
            C("snap-pea", "Snap Pea", "Pisum sativum", new[] { "vegetable", "legume" }, daysToMaturity: 65, plantSpacing: 2, canDirectSow: true),
            C("corn", "Sweet Corn", "Zea mays", new[] { "grain", "vegetable" }, daysToMaturity: 85, plantSpacing: 12, canDirectSow: true),
            C("potato", "Potato", "Solanum tuberosum", new[] { "vegetable", "root" }, daysToMaturity: 90, plantSpacing: 12),
            C("sweet-potato", "Sweet Potato", "Ipomoea batatas", new[] { "vegetable", "root" }, daysToMaturity: 110, plantSpacing: 12),
            C("strawberry", "Strawberry", "Fragaria × ananassa", new[] { "fruit" }, daysToMaturity: 90, plantSpacing: 12),
            C("blueberry", "Blueberry", "Vaccinium corymbosum", new[] { "fruit" }, daysToMaturity: 730, plantSpacing: 60),
            C("raspberry", "Raspberry", "Rubus idaeus", new[] { "fruit" }, daysToMaturity: 730, plantSpacing: 36),
            C("basil", "Basil", "Ocimum basilicum", new[] { "herb" }, daysToMaturity: 60, plantSpacing: 12),
            C("cilantro", "Cilantro", "Coriandrum sativum", new[] { "herb" }, daysToMaturity: 50, plantSpacing: 6, canDirectSow: true),
            C("parsley", "Parsley", "Petroselinum crispum", new[] { "herb" }, daysToMaturity: 75, plantSpacing: 8),
            C("rosemary", "Rosemary", "Salvia rosmarinus", new[] { "herb" }, daysToMaturity: 90, plantSpacing: 24),
            C("thyme", "Thyme", "Thymus vulgaris", new[] { "herb" }, daysToMaturity: 75, plantSpacing: 12),
            C("oregano", "Oregano", "Origanum vulgare", new[] { "herb" }, daysToMaturity: 80, plantSpacing: 12),
            C("mint", "Mint", "Mentha", new[] { "herb" }, daysToMaturity: 90, plantSpacing: 18),
            C("chives", "Chives", "Allium schoenoprasum", new[] { "herb" }, daysToMaturity: 80, plantSpacing: 6),
            C("dill", "Dill", "Anethum graveolens", new[] { "herb" }, daysToMaturity: 60, plantSpacing: 6, canDirectSow: true),
            C("sage", "Sage", "Salvia officinalis", new[] { "herb" }, daysToMaturity: 75, plantSpacing: 18),
        }
        .Select(c => { c.LastSyncedUtc = now; return c; })
        .ToList();

        db.Crops.AddRange(crops);
        await db.SaveChangesAsync(ct);
    }

    private static Crop C(string slug, string commonName, string scientific, string[] tags,
        int? daysToMaturity = null, double? plantSpacing = null, bool canDirectSow = false) => new()
        {
            Slug = slug,
            CommonName = commonName,
            ScientificName = scientific,
            DaysToMaturity = daysToMaturity,
            PlantSpacingInches = plantSpacing,
            CanDirectSow = canDirectSow,
            Tags = tags
        };
}
