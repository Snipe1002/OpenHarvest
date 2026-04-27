using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenHarvest.Domain.Components;
using OpenHarvest.Domain.Entities;
using OpenHarvest.Domain.ValueObjects;

namespace OpenHarvest.Infrastructure.Data.Configurations;

/// <summary>
/// Maps GardenEntity to a Postgres table with components stored as JSONB columns.
/// JSONB lets us add new components or fields without migrations and lets us GIN-index
/// component-presence queries cheaply.
/// </summary>
public class GardenEntityConfiguration : IEntityTypeConfiguration<GardenEntity>
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public void Configure(EntityTypeBuilder<GardenEntity> b)
    {
        b.ToTable("garden_entities");
        b.HasKey(e => e.Id);

        b.Property(e => e.Name).HasMaxLength(200).IsRequired();
        b.Property(e => e.CropRef).HasMaxLength(200);
        b.Property(e => e.Kind).HasConversion<string>().HasMaxLength(40);

        // Phase 5.3 — tags as native Postgres text[]. Npgsql maps string[] to text[]
        // automatically; we declare the column type explicitly so the migration is unambiguous
        // and so a future GIN index can target the column without surprises.
        b.Property(e => e.Tags).HasColumnType("text[]").IsRequired();

        b.Property(e => e.Transform).HasColumnType("jsonb").HasConversion(
            v => JsonSerializer.Serialize(v, JsonOptions),
            v => JsonSerializer.Deserialize<Transform>(v, JsonOptions)!);

        b.Property(e => e.Geometry).HasColumnType("jsonb").HasConversion(
            v => JsonSerializer.Serialize(v, JsonOptions),
            v => JsonSerializer.Deserialize<Geometry>(v, JsonOptions)!);

        b.Property(e => e.Photos).HasColumnType("jsonb").HasConversion(
            v => v == null ? null : JsonSerializer.Serialize(v, JsonOptions),
            v => v == null ? null : JsonSerializer.Deserialize<PhotoLog>(v, JsonOptions));

        b.Property(e => e.Growth).HasColumnType("jsonb").HasConversion(
            v => v == null ? null : JsonSerializer.Serialize(v, JsonOptions),
            v => v == null ? null : JsonSerializer.Deserialize<GrowthLog>(v, JsonOptions));

        b.Property(e => e.Schedule).HasColumnType("jsonb").HasConversion(
            v => v == null ? null : JsonSerializer.Serialize(v, JsonOptions),
            v => v == null ? null : JsonSerializer.Deserialize<ScheduleComponent>(v, JsonOptions));

        b.Property(e => e.Yield).HasColumnType("jsonb").HasConversion(
            v => v == null ? null : JsonSerializer.Serialize(v, JsonOptions),
            v => v == null ? null : JsonSerializer.Deserialize<YieldLog>(v, JsonOptions));

        b.Property(e => e.Health).HasColumnType("jsonb").HasConversion(
            v => v == null ? null : JsonSerializer.Serialize(v, JsonOptions),
            v => v == null ? null : JsonSerializer.Deserialize<HealthLog>(v, JsonOptions));

        b.Property(e => e.Extensions).HasColumnType("jsonb").HasConversion(
            v => JsonSerializer.Serialize(v, JsonOptions),
            v => JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(v, JsonOptions)!
                 ?? new Dictionary<string, JsonElement>());

        b.HasIndex(e => new { e.GardenId, e.ModifiedUtc });
        b.HasIndex(e => new { e.GardenId, e.Kind });
        b.HasIndex(e => e.ParentId);
    }
}
