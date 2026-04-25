using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenHarvest.Domain.Entities;

namespace OpenHarvest.Infrastructure.Data.Configurations;

public class CropConfiguration : IEntityTypeConfiguration<Crop>
{
    public void Configure(EntityTypeBuilder<Crop> b)
    {
        b.ToTable("crops");
        b.HasKey(c => c.Slug);

        b.Property(c => c.Slug).HasMaxLength(120);
        b.Property(c => c.CommonName).HasMaxLength(200).IsRequired();
        b.Property(c => c.ScientificName).HasMaxLength(200);
        b.Property(c => c.Description).HasMaxLength(2000);
        b.Property(c => c.Tags).HasColumnType("text[]");

        b.HasIndex(c => c.CommonName);
    }
}
