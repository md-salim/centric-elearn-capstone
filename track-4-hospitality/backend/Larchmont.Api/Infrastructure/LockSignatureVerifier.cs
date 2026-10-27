using System.Security.Cryptography;
using System.Text;

namespace Larchmont.Api.Infrastructure;

public interface ILockSignatureVerifier
{
    /// <summary>True only when the header is "sha256=" plus the HMAC-SHA256 of the raw body, keyed by the shared secret.</summary>
    bool IsValid(byte[] rawBody, string? signatureHeader);
}

/// <summary>
/// Checks the lock system's X-Signature header (BR-13). The secret comes only from configuration key
/// LockEvents:SharedSecret (environment LockEvents__SharedSecret). It is never stored in appsettings.
/// Fails closed: with no secret configured every call is refused.
/// </summary>
public class LockSignatureVerifier : ILockSignatureVerifier
{
    private const string Prefix = "sha256=";
    private readonly byte[]? _secret;

    public LockSignatureVerifier(IConfiguration configuration)
    {
        var secret = configuration["LockEvents:SharedSecret"];
        _secret = string.IsNullOrEmpty(secret) ? null : Encoding.UTF8.GetBytes(secret);
    }

    public bool IsValid(byte[] rawBody, string? signatureHeader)
    {
        if (_secret is null || string.IsNullOrWhiteSpace(signatureHeader)) return false;
        var header = signatureHeader.Trim();
        if (!header.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase)) return false;

        var provided = Encoding.ASCII.GetBytes(header[Prefix.Length..].Trim().ToLowerInvariant());
        var expected = Encoding.ASCII.GetBytes(
            Convert.ToHexString(HMACSHA256.HashData(_secret, rawBody)).ToLowerInvariant());
        // Constant-time comparison, so the time taken does not reveal how many leading characters matched.
        return CryptographicOperations.FixedTimeEquals(expected, provided);
    }
}
