using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OpenHarvest.Domain.Interfaces;
using OpenHarvest.Infrastructure.Data;
using OpenHarvest.Infrastructure.Storage;

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

        services.Configure<MinioOptions>(config.GetSection("Minio"));
        services.AddSingleton<IPhotoStore, MinioPhotoStore>();

        return services;
    }
}
