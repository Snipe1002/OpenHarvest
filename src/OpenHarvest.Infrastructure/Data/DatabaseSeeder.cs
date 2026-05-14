using Microsoft.EntityFrameworkCore;
using OpenHarvest.Domain.Components;
using OpenHarvest.Domain.Entities;
using OpenHarvest.Domain.Enums;
using OpenHarvest.Domain.ValueObjects;

namespace OpenHarvest.Infrastructure.Data;

/// <summary>
/// Phase 0 seeder. Inserts a single demo garden with one bed and one tomato plant
/// so the API has something to return and the canvas has something to render.
/// Idempotent — only seeds when the gardens table is empty.
/// </summary>
public static class DatabaseSeeder
{
    public static readonly Guid DemoGardenId = new("11111111-1111-1111-1111-111111111111");
    public static readonly Guid DemoBedId    = new("22222222-2222-2222-2222-222222222222");
    public static readonly Guid DemoPlantId  = new("33333333-3333-3333-3333-333333333333");

    /// <summary>Default yard for walk-mode captures (slug "home"). Idempotently seeded
    /// alongside the demo garden so a single-user install always has a destination for
    /// the multi-property seam.</summary>
    public static readonly Guid DefaultYardId = new("44444444-4444-4444-4444-444444444444");

    public static async Task SeedAsync(OpenHarvestDbContext db, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;

        if (!db.Gardens.Any())
        {
            db.Gardens.Add(new Garden
            {
                Id = DemoGardenId,
                Name = "Demo Garden",
                CreatedAt = now
            });

            db.Entities.AddRange(
                new GardenEntity
                {
                    Id = DemoBedId,
                    GardenId = DemoGardenId,
                    ParentId = null,
                    Kind = EntityKind.Bed,
                    Name = "Backyard Bed",
                    Transform = new Transform(new Vector3(0, 0, 0), Quaternion.Identity, Vector3.One),
                    Geometry = Geometry.Box(new Vector3(4, 0.5, 8)),
                    CreatedUtc = now,
                    ModifiedUtc = now
                },
                new GardenEntity
                {
                    Id = DemoPlantId,
                    GardenId = DemoGardenId,
                    ParentId = DemoBedId,
                    Kind = EntityKind.Plant,
                    Name = "Brandywine Tomato",
                    CropRef = "brandywine-tomato",
                    Transform = new Transform(new Vector3(0, 0.5, 0), Quaternion.Identity, Vector3.One),
                    Geometry = Geometry.Cylinder(0.3, 1.2),
                    CreatedUtc = now,
                    ModifiedUtc = now
                });
        }

        // Default yard for walk-mode. Wired to the demo garden so promoted captures have
        // somewhere to land. Idempotent so this seeder can run on existing databases that
        // already have gardens but no yard row.
        if (!await db.Yards.AnyAsync(y => y.Slug == "home", ct))
        {
            db.Yards.Add(new Yard
            {
                Id = DefaultYardId,
                Slug = "home",
                Name = "Home",
                GardenId = DemoGardenId,
                CreatedUtc = now,
            });
        }

        await db.SaveChangesAsync(ct);
    }
}
