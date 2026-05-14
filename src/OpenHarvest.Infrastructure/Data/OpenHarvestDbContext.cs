using Microsoft.EntityFrameworkCore;
using OpenHarvest.Domain.Entities;

namespace OpenHarvest.Infrastructure.Data;

public class OpenHarvestDbContext : DbContext
{
    public OpenHarvestDbContext(DbContextOptions<OpenHarvestDbContext> options)
        : base(options) { }

    public DbSet<Garden> Gardens => Set<Garden>();
    public DbSet<GardenEntity> Entities => Set<GardenEntity>();
    public DbSet<Crop> Crops => Set<Crop>();
    // Phase 5.4 — user-saved prefab templates ("My Prefabs"). Per-garden.
    public DbSet<CustomPrefab> CustomPrefabs => Set<CustomPrefab>();

    // Walk-mode v1 — phone capture flow. A yard groups captures across walks; a walk
    // groups captures into a single session; each capture has zero or more vision-classifier
    // proposals attached. yard_id is denormalised onto every row so a multi-yard rollup
    // (the v2 seam) doesn't have to traverse FKs.
    public DbSet<Yard> Yards => Set<Yard>();
    public DbSet<WalkSession> WalkSessions => Set<WalkSession>();
    public DbSet<Capture> Captures => Set<Capture>();
    public DbSet<ClassificationProposal> ClassificationProposals => Set<ClassificationProposal>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(OpenHarvestDbContext).Assembly);
    }
}
