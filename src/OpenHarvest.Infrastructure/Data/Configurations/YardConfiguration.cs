using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenHarvest.Domain.Entities;

namespace OpenHarvest.Infrastructure.Data.Configurations;

public class YardConfiguration : IEntityTypeConfiguration<Yard>
{
    public void Configure(EntityTypeBuilder<Yard> b)
    {
        b.ToTable("yards");
        b.HasKey(y => y.Id);
        b.Property(y => y.Slug).HasMaxLength(64).IsRequired();
        b.Property(y => y.Name).HasMaxLength(200).IsRequired();
        b.HasIndex(y => y.Slug).IsUnique();
    }
}
