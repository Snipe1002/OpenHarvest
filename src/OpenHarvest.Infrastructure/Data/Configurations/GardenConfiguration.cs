using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenHarvest.Domain.Entities;

namespace OpenHarvest.Infrastructure.Data.Configurations;

public class GardenConfiguration : IEntityTypeConfiguration<Garden>
{
    public void Configure(EntityTypeBuilder<Garden> b)
    {
        b.ToTable("gardens");
        b.HasKey(g => g.Id);
        b.Property(g => g.Name).HasMaxLength(200).IsRequired();
    }
}
