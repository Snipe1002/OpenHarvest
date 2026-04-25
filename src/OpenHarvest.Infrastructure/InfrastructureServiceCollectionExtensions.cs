using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OpenHarvest.Domain.Interfaces;
using OpenHarvest.Infrastructure.Data;

namespace OpenHarvest.Infrastructure;

public static class InfrastructureServiceCollectionExtensions
{
    public static IServiceCollection AddOpenHarvestInfrastructure(
        this IServiceCollection services,
        IConfiguration config)
    {
        var conn = config.GetConnectionString("Postgres")
            ?? throw new InvalidOperationException(
                "Missing connection string 'Postgres' (set ConnectionStrings__Postgres env var).");

        services.AddDbContext<OpenHarvestDbContext>(opts =>
            opts.UseNpgsql(conn));

        services.AddScoped<IGardenRepository, GardenRepository>();
        services.AddScoped<ICropRepository, CropRepository>();
        return services;
    }
}
