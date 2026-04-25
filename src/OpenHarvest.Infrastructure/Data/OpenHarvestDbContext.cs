using Microsoft.EntityFrameworkCore;
using OpenHarvest.Domain.Entities;

namespace OpenHarvest.Infrastructure.Data;

public class OpenHarvestDbContext : DbContext
{
    public OpenHarvestDbContext(DbContextOptions<OpenHarvestDbContext> options)
        : base(options) { }

    public DbSet<Garden> Gardens => Set<Garden>();
    public DbSet<GardenEntity> Entities => Set<GardenEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(OpenHarvestDbContext).Assembly);
    }
}
