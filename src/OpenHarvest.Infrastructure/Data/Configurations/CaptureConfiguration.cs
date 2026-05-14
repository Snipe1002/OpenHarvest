using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenHarvest.Domain.Entities;
using OpenHarvest.Domain.ValueObjects;

namespace OpenHarvest.Infrastructure.Data.Configurations;

public class CaptureConfiguration : IEntityTypeConfiguration<Capture>
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public void Configure(EntityTypeBuilder<Capture> b)
    {
        b.ToTable("captures");
        b.HasKey(c => c.Id);

        b.Property(c => c.PhotoObjectKey).HasMaxLength(500).IsRequired();
        b.Property(c => c.Status).HasConversion<string>().HasMaxLength(30).IsRequired();
        b.Property(c => c.Note).HasMaxLength(2000);
        b.Property(c => c.ClassificationError).HasMaxLength(2000);

        b.Property(c => c.ManualReadings).HasColumnType("jsonb").HasConversion(
            v => JsonSerializer.Serialize(v, JsonOptions),
            v => JsonSerializer.Deserialize<List<ManualReading>>(v, JsonOptions) ?? new List<ManualReading>());

        // Classification worker scans for pending captures, so the per-status index keeps
        // that poll cheap. Review-list queries hit by walk_session_id; covered separately.
        b.HasIndex(c => new { c.WalkSessionId, c.CapturedUtc });
        b.HasIndex(c => c.Status);
        b.HasIndex(c => c.YardId);
    }
}
