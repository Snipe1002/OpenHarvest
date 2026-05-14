using System.Security.Cryptography;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OpenHarvest.Domain.Interfaces;

namespace OpenHarvest.Infrastructure.Storage;

public class WalkPhotoStoreOptions
{
    /// <summary>
    /// Root directory for walk-mode photo blobs. Set via the <c>OPENHARVEST_PHOTO_DIR</c> env
    /// var or <c>OpenHarvest:WalkPhotoDir</c> config key. Defaults to <c>data/photos</c> relative
    /// to the API's content root, mirroring the convention of the rest of the project's
    /// gitignored runtime directories.
    /// </summary>
    public string Directory { get; set; } = "data/photos";

    /// <summary>
    /// Public URL prefix the browser should hit when it follows a returned URL. Defaults to the
    /// API's own route at <c>/api/v1/walks/photos/</c>; an admin who fronts blobs from a CDN
    /// can override this to point elsewhere. The trailing slash is added automatically.
    /// </summary>
    public string PublicUrlBase { get; set; } = "/api/v1/walks/photos/";
}

/// <summary>
/// Filesystem-backed walk-photo store. Keys are sha256(contents) so two identical photos
/// dedupe naturally — useful when a phone retries an upload. Files are written atomically:
/// a temp file in the same directory, then renamed onto the target name so a concurrent
/// reader never sees a partial write.
/// </summary>
public class FilesystemWalkPhotoStore : IWalkPhotoStore
{
    private readonly WalkPhotoStoreOptions _opts;
    private readonly ILogger<FilesystemWalkPhotoStore> _log;
    private readonly string _root;

    public FilesystemWalkPhotoStore(
        IOptions<WalkPhotoStoreOptions> opts,
        ILogger<FilesystemWalkPhotoStore> log,
        IHostContentRoot? root = null)
    {
        _opts = opts.Value;
        _log = log;
        var dir = string.IsNullOrWhiteSpace(_opts.Directory) ? "data/photos" : _opts.Directory;
        _root = Path.IsPathRooted(dir)
            ? dir
            : Path.Combine(root?.ContentRootPath ?? Directory.GetCurrentDirectory(), dir);
        Directory.CreateDirectory(_root);
    }

    public async Task<string> UploadAsync(Stream photo, string contentType, CancellationToken ct = default)
    {
        // Buffer to a temp file in the target directory so the cross-device-link concern
        // doesn't apply and so File.Move is atomic on the same filesystem.
        var ext = ExtensionFromContentType(contentType);
        var tempPath = Path.Combine(_root, $".incoming-{Guid.NewGuid():N}{ext}");

        string key;
        // Two-stage: write the photo bytes to a temp file, then re-open it just to compute
        // the hash. Doing the hash from disk avoids holding the whole photo in memory and
        // sidesteps the seekability question on the inbound stream.
        await using (var fs = File.Create(tempPath))
        {
            await photo.CopyToAsync(fs, ct);
            await fs.FlushAsync(ct);
        }
        await using (var fs = File.OpenRead(tempPath))
        using (var sha = SHA256.Create())
        {
            var hash = await sha.ComputeHashAsync(fs, ct);
            key = Convert.ToHexString(hash).ToLowerInvariant() + ext;
        }

        var finalPath = Path.Combine(_root, key);
        // The hash is the dedupe key. If the target already exists the temp file is
        // redundant and gets discarded; otherwise we promote it.
        if (File.Exists(finalPath))
        {
            try { File.Delete(tempPath); }
            catch { /* best effort — orphaned temp is acceptable */ }
        }
        else
        {
            File.Move(tempPath, finalPath);
        }
        // Sidecar the content type so OpenReadAsync can serve it back without sniffing.
        var ctPath = finalPath + ".ct";
        if (!File.Exists(ctPath))
        {
            await File.WriteAllTextAsync(ctPath, string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType, ct);
        }
        return key;
    }

    public Task<Stream> OpenReadAsync(string objectKey, CancellationToken ct = default)
    {
        var path = ResolveKey(objectKey);
        if (!File.Exists(path)) throw new FileNotFoundException("photo not found", objectKey);
        Stream stream = File.OpenRead(path);
        return Task.FromResult(stream);
    }

    public async Task<string?> GetContentTypeAsync(string objectKey, CancellationToken ct = default)
    {
        var path = ResolveKey(objectKey) + ".ct";
        if (!File.Exists(path)) return null;
        return (await File.ReadAllTextAsync(path, ct)).Trim();
    }

    public Task<string> GetUrlAsync(string objectKey, TimeSpan expiry, CancellationToken ct = default)
    {
        var prefix = string.IsNullOrWhiteSpace(_opts.PublicUrlBase) ? "/api/v1/walks/photos/" : _opts.PublicUrlBase;
        if (!prefix.EndsWith('/')) prefix += "/";
        return Task.FromResult(prefix + Uri.EscapeDataString(objectKey));
    }

    public Task DeleteAsync(string objectKey, CancellationToken ct = default)
    {
        var path = ResolveKey(objectKey);
        try
        {
            if (File.Exists(path)) File.Delete(path);
            var ctPath = path + ".ct";
            if (File.Exists(ctPath)) File.Delete(ctPath);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "failed to delete walk photo {Key}", objectKey);
        }
        return Task.CompletedTask;
    }

    private string ResolveKey(string objectKey)
    {
        // Defence in depth — strip path separators so a malformed key can't escape the root.
        var clean = objectKey.Replace('/', '_').Replace('\\', '_');
        return Path.Combine(_root, clean);
    }

    private static string ExtensionFromContentType(string? ct) =>
        ct?.ToLowerInvariant() switch
        {
            "image/jpeg" or "image/jpg" => ".jpg",
            "image/png" => ".png",
            "image/webp" => ".webp",
            "image/heic" => ".heic",
            "image/heif" => ".heif",
            _ => ".bin",
        };
}

/// <summary>Tiny abstraction over <c>IHostEnvironment.ContentRootPath</c> so the store can stay
/// in the Infrastructure project without taking an ASP.NET Core dependency.</summary>
public interface IHostContentRoot
{
    string ContentRootPath { get; }
}
