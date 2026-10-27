using Larchmont.Api.Data;
using Larchmont.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;
using MySqlConnector;

namespace Larchmont.Api.Repositories;

/// <summary>Shared save handling for the repositories that write rooms, bookings and floor assignments.</summary>
internal static class DbSave
{
    /// <summary>MySQL error 1062: duplicate entry for a unique key.</summary>
    private const int DuplicateKeyNumber = 1062;

    /// <summary>Save, turning a lost optimistic-concurrency race into a 409 (AC-25).</summary>
    public static async Task SaveAsync(LarchmontDbContext db, string conflictMessage)
    {
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateConcurrencyException)
        {
            throw new ConflictException(conflictMessage);
        }
    }

    /// <summary>True when the failure is a MySQL unique-key violation (error 1062).</summary>
    public static bool IsDuplicateKey(DbUpdateException ex) =>
        ex.InnerException is MySqlException { Number: DuplicateKeyNumber };
}
