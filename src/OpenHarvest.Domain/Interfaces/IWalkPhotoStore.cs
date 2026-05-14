namespace OpenHarvest.Domain.Interfaces;

/// <summary>
/// Photo storage for walk-mode captures. Distinct from <see cref="IPhotoStore"/> (which is
/// backed by MinIO and used by the entity-attached photo log) so walk-mode can run on a
/// filesystem-only deployment — useful for self-hosters who don't want to stand up an S3 stack
/// just to use the phone capture flow. The implementation is chosen at startup based on the
/// <c>OpenHarvest:WalkPhotoStore</c> configuration value ("filesystem" or "minio").
/// </summary>
public interface IWalkPhotoStore
{
    /// <summary>Upload raw photo bytes; returns the storage key.</summary>
    Task<string> UploadAsync(Stream photo, string contentType, CancellationToken ct = default);

    /// <summary>Open the photo for reading. Caller disposes.</summary>
    Task<Stream> OpenReadAsync(string objectKey, CancellationToken ct = default);

    /// <summary>Detected content type for the stored photo, or null if unknown.</summary>
    Task<string?> GetContentTypeAsync(string objectKey, CancellationToken ct = default);

    /// <summary>Get a URL the browser can fetch — for filesystem this is an API route, for MinIO a presigned URL.</summary>
    Task<string> GetUrlAsync(string objectKey, TimeSpan expiry, CancellationToken ct = default);

    Task DeleteAsync(string objectKey, CancellationToken ct = default);
}
