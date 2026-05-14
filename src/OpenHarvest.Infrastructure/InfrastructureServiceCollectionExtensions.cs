using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OpenHarvest.Application.Nudges;
using OpenHarvest.Domain.Interfaces;
using OpenHarvest.Infrastructure.AI;
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
        services.AddScoped<ICustomPrefabRepository, CustomPrefabRepository>();

        services.Configure<MinioOptions>(config.GetSection("Minio"));
        services.AddSingleton<IPhotoStore, MinioPhotoStore>();

        services.Configure<ClaudeOptions>(config.GetSection("AI:Claude"));
        services.AddHttpClient<IAiProvider, ClaudeProvider>();

        services.AddScoped<NudgeScanner>();

        // Walk-mode v1 wiring. The photo store is filesystem-by-default so a fresh install can
        // run without standing up MinIO; admins who already have S3 can override by binding
        // OpenHarvest:WalkPhotoStore to "minio" later (currently only "filesystem" ships).
        services.Configure<WalkPhotoStoreOptions>(config.GetSection("OpenHarvest:WalkPhoto"));
        services.AddSingleton<IHostContentRoot>(sp =>
        {
            var env = sp.GetRequiredService<IHostEnvironment>();
            return new HostContentRootAdapter(env.ContentRootPath);
        });
        services.AddSingleton<IWalkPhotoStore, FilesystemWalkPhotoStore>();

        services.Configure<VisionClientOptions>(config.GetSection("OpenHarvest:Vision"));
        services.AddHttpClient<IVisionClient, VisionClient>();

        services.AddHostedService<ClassificationWorker>();

        return services;
    }

    private sealed class HostContentRootAdapter : IHostContentRoot
    {
        public HostContentRootAdapter(string contentRootPath) => ContentRootPath = contentRootPath;
        public string ContentRootPath { get; }
    }
}
