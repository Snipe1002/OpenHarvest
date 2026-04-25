namespace OpenHarvest.Domain.Interfaces;

public interface IPhotoStore
{
    /// <summary>Upload a photo blob and return the storage object key.</summary>
    Task<string> UploadAsync(Stream photo, string contentType, CancellationToken ct = default);

    /// <summary>Get a presigned URL the browser can fetch directly.</summary>
    Task<string> GetUrlAsync(string objectKey, TimeSpan expiry, CancellationToken ct = default);

    /// <summary>Delete an uploaded photo.</summary>
    Task DeleteAsync(string objectKey, CancellationToken ct = default);
}
