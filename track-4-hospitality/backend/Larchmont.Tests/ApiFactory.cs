using System.Reflection;
using Larchmont.Api.Data;
using Larchmont.Api.Domain;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Larchmont.Tests;

public class ApiFactory : WebApplicationFactory<Program>
{
    public const string DefaultLockSecret = "test-lock-secret-not-for-production";

    private readonly string _dbName = "larchmont-" + Guid.NewGuid();

    /// <summary>Fixed clock (replaces TimeProvider). Starts at 09:00 UTC on 2026-10-27; tests move it explicitly.</summary>
    public FakeClock Time { get; } = new(TestTimes.At(9));

    /// <summary>Lock webhook secret for this factory. Null means "no secret configured". Set before first use.</summary>
    public string? LockSecret { get; set; } = DefaultLockSecret;

    /// <summary>Recording stand-in for IBoardNotifier. Null until the backend registers that interface.</summary>
    public RecordingProxy? BoardNotifier { get; private set; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        var secret = LockSecret;
        builder.ConfigureAppConfiguration((_, cfg) =>
            cfg.AddInMemoryCollection(new Dictionary<string, string?> { ["LockEvents:SharedSecret"] = secret }));
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<LarchmontDbContext>>();
            services.AddDbContext<LarchmontDbContext>(o => o.UseInMemoryDatabase(_dbName));

            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Time);

            // Replace IBoardNotifier (if the backend has one) with a recording stand-in so tests can count pushes.
            var notifierType = typeof(Program).Assembly.GetTypes()
                .FirstOrDefault(t => t.IsInterface && t.Name == "IBoardNotifier");
            if (notifierType is not null)
            {
                var proxy = (RecordingProxy)DispatchProxy.Create(notifierType, typeof(RecordingProxy));
                services.RemoveAll(notifierType);
                services.AddSingleton(notifierType, proxy);
                BoardNotifier = proxy;
            }
        });
    }

    public void Seed(Action<LarchmontDbContext> seed)
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LarchmontDbContext>();
        seed(db);
        db.SaveChanges();
    }

    private bool _seeded;

    public void SeedBasics()
    {
        if (_seeded) return;
        _seeded = true;
        Seed(db =>
        {
            db.Hotels.Add(new Hotel { Id = 1, Code = "EDI", Name = "Larchmont Edinburgh", City = "Edinburgh", Region = "Scotland", AddressLine = "14 Castle Terrace", Phone = "+44 131 555 0101" });
            db.RoomTypes.Add(new RoomType { Id = 1, Code = "STD", Name = "Standard Double", MaxOccupancy = 2, BaseRate = 95 });
        });
    }
}

/// <summary>Clock that tests set explicitly. Never reads the wall clock.</summary>
public sealed class FakeClock : TimeProvider
{
    private DateTimeOffset _now;

    public FakeClock(DateTimeOffset start) => _now = start;

    public override DateTimeOffset GetUtcNow() => _now;

    public void Set(DateTimeOffset value) => _now = value;
}

/// <summary>
/// Dynamic proxy for any interface. Counts every call and returns a completed Task for Task-returning methods.
/// Used as the IBoardNotifier stand-in so tests can count pushes without knowing the method signature.
/// </summary>
public class RecordingProxy : DispatchProxy
{
    public int Calls { get; private set; }

    protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
    {
        Calls++;
        var returnType = targetMethod?.ReturnType ?? typeof(void);
        if (returnType == typeof(Task)) return Task.CompletedTask;
        if (returnType == typeof(ValueTask)) return default(ValueTask);
        return null;
    }
}
