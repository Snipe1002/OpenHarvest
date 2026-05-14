using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenHarvest.Domain.Entities;

namespace OpenHarvest.Infrastructure.Data.Configurations;

public class WalkSessionConfiguration : IEntityTypeConfiguration<WalkSession>
{
    public void Configure(EntityTypeBuilder<WalkSession> b)
    {
        b.ToTable("walk_sessions");
        b.HasKey(s => s.Id);
        b.Property(s => s.Status).HasConversion<string>().HasMaxLength(20).IsRequired();
        b.Property(s => s.Note).HasMaxLength(2000);

        // Most queries hit "what walks happened in this yard, newest first" so the index
        // pairs (YardId, StartedUtc) to cover the common review-list path.
        b.HasIndex(s => new { s.YardId, s.StartedUtc });
    }
}
