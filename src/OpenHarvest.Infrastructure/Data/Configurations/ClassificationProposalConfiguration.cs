using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenHarvest.Domain.Entities;

namespace OpenHarvest.Infrastructure.Data.Configurations;

public class ClassificationProposalConfiguration : IEntityTypeConfiguration<ClassificationProposal>
{
    public void Configure(EntityTypeBuilder<ClassificationProposal> b)
    {
        b.ToTable("classification_proposals");
        b.HasKey(p => p.Id);

        b.Property(p => p.Kind).HasMaxLength(80).IsRequired();

        // Payload is opaque JSON from the vision endpoint — store as jsonb so future
        // model versions can add fields without a migration.
        b.Property(p => p.Payload).HasColumnType("jsonb").HasConversion(
            v => v.HasValue ? JsonSerializer.Serialize(v.Value, (JsonSerializerOptions?)null) : null,
            v => v == null ? (JsonElement?)null : JsonDocument.Parse(v, default).RootElement.Clone());

        b.HasIndex(p => p.CaptureId);
        b.HasIndex(p => p.YardId);
    }
}
