using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Minio;
using Minio.DataModel.Args;
using OpenHarvest.Domain.Interfaces;

namespace OpenHarvest.Infrastructure.Storage;

public class MinioOptions
{
    public string Endpoint { get; set; } = "minio:9000";
    public string AccessKey { get; set; } = "openharvest";
    public string SecretKey { get; set; } = "openharvest";
    public string Bucket { get; set; } = "photos";
    public bool UseSsl { get; set; } = false;
    /// <summary>
    /// External URL the browser should hit when it follows a presigned URL. The internal
    /// Endpoint resolves inside the docker network ("minio:9000"); the browser needs a
    /// publicly-reachable URL like "http://localhost:9000".
    /// </summary>
    public string PresignedUrlBase { get; set; } = "http://localhost:9000";
}

public class MinioPhotoStore : IPhotoStore
{
    private readonly IMinioClient _client;
    private readonly MinioOptions _opts;
    private readonly ILogger<MinioPhotoStore> _log;

    public MinioPhotoStore(IOptions<MinioOptions> opts, ILogger<MinioPhotoStore> log)
    {
        _opts = opts.Value;
        _log = log;
        _client = new MinioClient()
            .WithEndpoint(_opts.Endpoint)
            .WithCredentials(_opts.AccessKey, _opts.SecretKey)
            .WithSSL(_opts.UseSsl)
            .Build();
    }

    public async Task EnsureBucketAsync(CancellationToken ct = default)
    {
        var exists = await _client.BucketExistsAsync(
            new BucketExistsArgs().WithBucket(_opts.Bucket), ct);
        if (!exists)
        {
            await _client.MakeBucketAsync(new MakeBucketArgs().WithBucket(_opts.Bucket), ct);
            _log.LogInformation("created MinIO bucket {Bucket}", _opts.Bucket);
        }
    }

    public async Task<string> UploadAsync(Stream photo, string contentType, CancellationToken ct = default)
    {
        await EnsureBucketAsync(ct);
        var key = $"photos/{Guid.NewGuid():N}";
        var args = new PutObjectArgs()
            .WithBucket(_opts.Bucket)
            .WithObject(key)
            .WithStreamData(photo)
            .WithObjectSize(photo.CanSeek ? photo.Length : -1)
            .WithContentType(string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType);
        await _client.PutObjectAsync(args, ct);
        return key;
    }

    public async Task<string> GetUrlAsync(string objectKey, TimeSpan expiry, CancellationToken ct = default)
    {
        var args = new PresignedGetObjectArgs()
            .WithBucket(_opts.Bucket)
            .WithObject(objectKey)
            .WithExpiry((int)expiry.TotalSeconds);
        var internalUrl = await _client.PresignedGetObjectAsync(args);

        // The presigned URL Minio generates points at the *internal* endpoint ("http://minio:9000/...").
        // Rewrite to the externally reachable base URL so the browser can follow it.
        var prefix = (_opts.UseSsl ? "https://" : "http://") + _opts.Endpoint;
        if (!string.IsNullOrEmpty(_opts.PresignedUrlBase) && internalUrl.StartsWith(prefix))
        {
            return _opts.PresignedUrlBase + internalUrl.Substring(prefix.Length);
        }
        return internalUrl;
    }

    public Task DeleteAsync(string objectKey, CancellationToken ct = default)
    {
        var args = new RemoveObjectArgs().WithBucket(_opts.Bucket).WithObject(objectKey);
        return _client.RemoveObjectAsync(args, ct);
    }
}
