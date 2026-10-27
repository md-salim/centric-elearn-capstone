using System.Text.RegularExpressions;
using Larchmont.Api.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;

namespace Larchmont.Api.Data;

public class LarchmontDbContext : DbContext
{
    /// <summary>Column names that do not follow the snake_case rule applied to the property name.</summary>
    private static readonly Dictionary<string, string> ColumnOverrides = new()
    {
        ["OutOfOrderReason"] = "ooo_reason",
    };

    public LarchmontDbContext(DbContextOptions<LarchmontDbContext> options) : base(options) { }

    public DbSet<Hotel> Hotels => Set<Hotel>();
    public DbSet<RoomType> RoomTypes => Set<RoomType>();
    public DbSet<RatePlan> RatePlans => Set<RatePlan>();
    public DbSet<RoomRate> RoomRates => Set<RoomRate>();
    public DbSet<Room> Rooms => Set<Room>();
    public DbSet<RoomStatusEvent> RoomStatusHistory => Set<RoomStatusEvent>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Guest> Guests => Set<Guest>();
    public DbSet<Booking> Bookings => Set<Booking>();
    public DbSet<BookingNote> BookingNotes => Set<BookingNote>();
    public DbSet<HousekeeperFloor> HousekeeperFloors => Set<HousekeeperFloor>();
    public DbSet<CheckoutEvent> CheckoutEvents => Set<CheckoutEvent>();

    /// <summary>
    /// Bumps RowVersion on every modified Room or Booking. EF then writes
    /// "WHERE row_version = @original", so a save over a row someone else changed
    /// matches no rows and raises DbUpdateConcurrencyException (mapped to 409 in the repositories).
    /// </summary>
    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        BumpRowVersions();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        BumpRowVersions();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    private void BumpRowVersions()
    {
        foreach (var entry in ChangeTracker.Entries().Where(e => e.State == EntityState.Modified))
        {
            if (entry.Entity is Room or Booking)
            {
                var property = entry.Property(nameof(Room.RowVersion));
                property.CurrentValue = Convert.ToInt32(property.OriginalValue) + 1;
            }
        }
    }

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Hotel>(e =>
        {
            e.ToTable("hotels");
            e.Property(x => x.Code).HasMaxLength(8);
            e.Property(x => x.Name).HasMaxLength(120);
            e.Property(x => x.City).HasMaxLength(80);
            e.Property(x => x.Region).HasMaxLength(20);
            e.Property(x => x.AddressLine).HasMaxLength(200);
            e.Property(x => x.Phone).HasMaxLength(30);
            e.HasIndex(x => x.Code).IsUnique();
        });
        b.Entity<RoomType>(e =>
        {
            e.ToTable("room_types");
            e.Property(x => x.Code).HasMaxLength(8);
            e.Property(x => x.Name).HasMaxLength(80);
            e.Property(x => x.BaseRate).HasColumnType("decimal(10,2)");
            e.Property(x => x.SlaMinutes).HasColumnType("smallint unsigned");
        });
        b.Entity<RatePlan>(e =>
        {
            e.ToTable("rate_plans");
            e.Property(x => x.Code).HasMaxLength(8);
            e.Property(x => x.Name).HasMaxLength(80);
            e.Property(x => x.DiscountPct).HasColumnType("decimal(5,2)");
        });
        b.Entity<RoomRate>(e =>
        {
            e.ToTable("room_rates");
            e.Property(x => x.NightlyRate).HasColumnType("decimal(10,2)");
        });
        b.Entity<Room>(e =>
        {
            e.ToTable("rooms");
            e.Property(x => x.RoomNumber).HasMaxLength(10);
            e.Property(x => x.Status).HasMaxLength(20);
            e.Property(x => x.Notes).HasMaxLength(255);
            e.Property(x => x.OutOfOrderReason).HasMaxLength(255);
            e.Property(x => x.RowVersion).IsConcurrencyToken();
            e.HasIndex(x => new { x.HotelId, x.RoomNumber }).IsUnique();
            e.HasIndex(x => new { x.HotelId, x.Floor, x.RoomNumber }).HasDatabaseName("ix_rooms_hotel_floor");
        });
        b.Entity<RoomStatusEvent>(e =>
        {
            e.ToTable("room_status_history");
            e.Property(x => x.FromStatus).HasMaxLength(20);
            e.Property(x => x.ToStatus).HasMaxLength(20);
            e.Property(x => x.Reason).HasMaxLength(255);
            e.Property(x => x.ByUserRole).HasMaxLength(20);
        });
        b.Entity<HousekeeperFloor>(e =>
        {
            e.ToTable("housekeeper_floors");
            e.HasKey(x => new { x.HotelId, x.Floor });
            e.HasIndex(x => x.UserId).HasDatabaseName("ix_housekeeper_floors_user");
        });
        b.Entity<CheckoutEvent>(e =>
        {
            e.ToTable("checkout_events");
            e.Property(x => x.BookingRef).HasMaxLength(20);
            e.Property(x => x.Source).HasMaxLength(10);
            e.HasIndex(x => new { x.BookingRef, x.CheckedOutAt }).IsUnique().HasDatabaseName("ux_checkout_events_ref_time");
        });
        b.Entity<User>(e =>
        {
            e.ToTable("users");
            e.Property(x => x.Email).HasMaxLength(200);
            e.Property(x => x.DisplayName).HasMaxLength(120);
            e.Property(x => x.Role).HasMaxLength(20);
            e.Property(x => x.PasswordHash).HasMaxLength(200);
            e.Property(x => x.Phone).HasMaxLength(30);
            e.HasIndex(x => x.Email).IsUnique();
        });
        b.Entity<Guest>(e =>
        {
            e.ToTable("guests");
            e.Property(x => x.FirstName).HasMaxLength(80);
            e.Property(x => x.LastName).HasMaxLength(80);
            e.Property(x => x.Email).HasMaxLength(200);
            e.Property(x => x.Phone).HasMaxLength(30);
            e.Property(x => x.AddressLine).HasMaxLength(200);
            e.Property(x => x.City).HasMaxLength(80);
            e.Property(x => x.Postcode).HasMaxLength(20);
            e.Property(x => x.Country).HasMaxLength(2);
            e.Property(x => x.Region).HasMaxLength(20);
            e.Property(x => x.LoyaltyTier).HasMaxLength(20);
            e.HasIndex(x => x.Email);
        });
        b.Entity<Booking>(e =>
        {
            e.ToTable("bookings");
            e.Ignore(x => x.Nights);
            e.Property(x => x.Reference).HasMaxLength(20);
            e.Property(x => x.ExternalRef).HasMaxLength(40);
            e.Property(x => x.Channel).HasMaxLength(30);
            e.Property(x => x.Status).HasMaxLength(20);
            e.Property(x => x.TotalAmount).HasColumnType("decimal(10,2)");
            e.Property(x => x.RowVersion).IsConcurrencyToken();
            e.HasIndex(x => x.Reference).IsUnique();
            e.HasIndex(x => new { x.HotelId, x.CheckIn });
        });
        b.Entity<BookingNote>(e =>
        {
            e.ToTable("booking_notes");
            e.Property(x => x.Note).HasMaxLength(1000);
        });

        foreach (var entity in b.Model.GetEntityTypes())
            foreach (var p in entity.GetProperties())
                p.SetColumnName(ColumnOverrides.TryGetValue(p.Name, out var column)
                    ? column
                    : Regex.Replace(p.Name, "(?<=[a-z0-9])([A-Z])", "_$1").ToLowerInvariant());
    }
}
