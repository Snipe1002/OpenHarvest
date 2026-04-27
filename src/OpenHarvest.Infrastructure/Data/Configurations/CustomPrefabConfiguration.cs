using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenHarvest.Domain.Entities;

namespace OpenHarvest.Infrastructure.Data.Configurations;

/// <summary>
/// Phase 5.4 — maps <see cref="CustomPrefab"/> to a snake_case Postgres table. GeometryJson /
/// TagsJson are plain text columns (the server treats them as opaque blobs round-tripped from
/// the client). The (GardenId, Slug) index is what the picker uses to load templates per
/// garden — it's the read path the frontend hits every time the picker opens.
/// </summary>
public class CustomPrefabConfiguration : IEntityTypeConfiguration<CustomPrefab>
{
    public void Configure(EntityTypeBuilder<CustomPrefab> b)
    {
        b.ToTable("custom_prefabs");
        b.HasKey(p => p.Id);

        b.Property(p => p.Slug).HasMaxLength(200).IsRequired();
        b.Property(p => p.Name).HasMaxLength(200).IsRequired();
        b.Property(p => p.Icon).HasMaxLength(16).IsRequired();
        b.Property(p => p.EntityKind).HasMaxLength(40).IsRequired();
        b.Property(p => p.CropRef).HasMaxLength(200);

        // text columns rather than jsonb — the contents are owned by the frontend (it
        // JSON.parse()s on read), and treating the field as opaque means new geometry kinds
        // don't force a schema dance.
        b.Property(p => p.GeometryJson).HasColumnType("text").IsRequired();
        b.Property(p => p.TagsJson).HasColumnType("text").IsRequired();

        b.HasIndex(p => new { p.GardenId, p.Slug });
    }
}
