using FluentValidation;
using Larchmont.Api.Domain;
using Larchmont.Api.Dtos;
using Larchmont.Api.Infrastructure;
using Larchmont.Api.Repositories;
using Larchmont.Api.Services;
using Larchmont.Api.Validators;
using Moq;

namespace Larchmont.Tests;

public class RateServiceTests
{
    private readonly Mock<IRateRepository> _rates = new();
    private RateService Sut() => new(_rates.Object, new RoomRateRequestValidator());

    [Fact]
    public async Task Quote_MultipliesNightlyRateByNights()
    {
        _rates.Setup(r => r.FindRateAsync(1, 1, 1, new DateOnly(2026, 10, 5)))
            .ReturnsAsync(new RoomRate { NightlyRate = 100m });
        var quote = await Sut().QuoteAsync(1, 1, 1, new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 8));
        Assert.Equal(3, quote.Nights);
        Assert.Equal(300m, quote.Total);
    }

    [Fact]
    public async Task Quote_CheckOutNotAfterCheckIn_IsRejected()
    {
        await Assert.ThrowsAsync<BusinessRuleException>(() =>
            Sut().QuoteAsync(1, 1, 1, new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 5)));
    }

    [Fact]
    public async Task Quote_WithNoRateLoaded_IsNotFound()
    {
        await Assert.ThrowsAsync<NotFoundException>(() =>
            Sut().QuoteAsync(1, 1, 1, new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 6)));
    }
}

public class BookingServiceTests
{
    private readonly Mock<IBookingRepository> _bookings = new();
    private readonly Mock<IGuestRepository> _guests = new();
    private readonly Mock<IHotelRepository> _hotels = new();
    private readonly Mock<IRoomTypeRepository> _types = new();
    private readonly Mock<IRoomRepository> _rooms = new();
    private readonly Mock<IRateRepository> _rates = new();

    private BookingService Sut() => new(_bookings.Object, _guests.Object, _hotels.Object, _types.Object, _rooms.Object,
        _rates.Object, new BookingRequestValidator(), new BookingUpdateRequestValidator(), new BookingNoteRequestValidator());

    private static Booking ConfirmedBooking(DateOnly checkIn, int nights = 2) => new()
    {
        Id = 7, HotelId = 1, GuestId = 1, RoomTypeId = 1, RatePlanId = 1, Status = BookingStatuses.Confirmed,
        CheckIn = checkIn, CheckOut = checkIn.AddDays(nights), TotalAmount = 200m
    };

    [Fact]
    public async Task Create_WhenAdultsExceedRoomCapacity_IsRejected()
    {
        _types.Setup(t => t.GetAsync(1)).ReturnsAsync(new RoomType { Id = 1, Name = "Standard Double", MaxOccupancy = 2 });
        var request = new BookingRequest(1, 1, 1, 1, new DateOnly(2026, 11, 3), new DateOnly(2026, 11, 5), 5, null);
        await Assert.ThrowsAnyAsync<Exception>(() => Sut().CreateAsync(request));
    }

    [Fact]
    public async Task Cancel_TwoDaysBeforeArrival_HasNoFee()
    {
        var booking = ConfirmedBooking(DateOnly.FromDateTime(DateTime.UtcNow.AddDays(2)));
        _bookings.Setup(b => b.GetAsync(7)).ReturnsAsync(booking);
        var result = await Sut().CancelAsync(7);
        Assert.Equal(0m, result.FeeAmount);
        Assert.Equal(BookingStatuses.Cancelled, booking.Status);
    }

    [Fact]
    public async Task Cancel_OnArrivalDay_ChargesFirstNight()
    {
        var booking = ConfirmedBooking(DateOnly.FromDateTime(DateTime.Now));
        _bookings.Setup(b => b.GetAsync(7)).ReturnsAsync(booking);
        var result = await Sut().CancelAsync(7);
        Assert.Equal(100m, result.FeeAmount);
    }

    [Fact]
    public async Task CheckIn_WithoutAssignedRoom_IsRejected()
    {
        _bookings.Setup(b => b.GetAsync(7)).ReturnsAsync(ConfirmedBooking(new DateOnly(2026, 10, 1)));
        await Assert.ThrowsAsync<BusinessRuleException>(() => Sut().CheckInAsync(7));
    }

    [Fact]
    public async Task AssignRoom_WhenRoomTaken_ThrowsConflict()
    {
        var booking = ConfirmedBooking(new DateOnly(2026, 10, 10));
        _bookings.Setup(b => b.GetAsync(7)).ReturnsAsync(booking);
        _rooms.Setup(r => r.GetAsync(5)).ReturnsAsync(new Room { Id = 5, HotelId = 1, RoomTypeId = 1, RoomNumber = "105" });
        _bookings.Setup(b => b.RoomHasOverlapAsync(5, 7, booking.CheckIn, booking.CheckOut)).ReturnsAsync(true);
        await Assert.ThrowsAsync<ConflictException>(() => Sut().AssignRoomAsync(7, new AssignRoomRequest(5)));
    }
}

public class ChannelImportServiceTests
{
    private const string Header = "external_ref,channel,hotel_code,room_type_code,guest_first,guest_last,guest_email,guest_phone,check_in,check_out,adults,rate_plan_code,total_amount,status\n";

    private readonly Mock<IBookingRepository> _bookings = new();
    private readonly Mock<IGuestRepository> _guests = new();
    private readonly Mock<IHotelRepository> _hotels = new();
    private readonly Mock<IRoomTypeRepository> _types = new();
    private readonly Mock<IRateRepository> _rates = new();

    private ChannelImportService Sut() => new(_bookings.Object, _guests.Object, _hotels.Object, _types.Object, _rates.Object);

    [Fact]
    public async Task Import_UnknownHotelCode_IsReportedAndSkipped()
    {
        var csv = Header + "BKG-1,BKG,ZZZ,STD,Ada,Lovelace,ada@example.com,07700900001,2026-10-10,2026-10-12,2,BAR,200.00,CONFIRMED\n";
        var result = await Sut().ImportAsync(csv);
        Assert.Equal(1, result.Skipped);
        Assert.Single(result.Errors);
    }

    [Fact]
    public async Task Import_MissingRequiredColumn_IsRejected()
    {
        await Assert.ThrowsAsync<BusinessRuleException>(() => Sut().ImportAsync("external_ref,channel\nX,Y\n"));
    }

    [Fact]
    public async Task Import_ValidRow_CreatesBooking()
    {
        _hotels.Setup(h => h.GetByCodeAsync("EDI")).ReturnsAsync(new Hotel { Id = 1, Code = "EDI", City = "Edinburgh", Region = "Scotland" });
        _types.Setup(t => t.GetByCodeAsync("STD")).ReturnsAsync(new RoomType { Id = 1, Code = "STD", MaxOccupancy = 2 });
        _rates.Setup(r => r.GetPlanByCodeAsync("BAR")).ReturnsAsync(new RatePlan { Id = 1, Code = "BAR" });
        _guests.Setup(g => g.GetByEmailAsync("ada@example.com")).ReturnsAsync(new Guest { Id = 4, Email = "ada@example.com" });
        _bookings.Setup(b => b.NextReferenceNumberAsync()).ReturnsAsync(50001);
        var csv = Header + "BKG-9,BKG,EDI,STD,Ada,Lovelace,ada@example.com,07700900001,2026-10-10,2026-10-12,2,BAR,200.00,CONFIRMED\n";
        var result = await Sut().ImportAsync(csv);
        Assert.Equal(1, result.Imported);
        _bookings.Verify(b => b.AddAsync(It.Is<Booking>(x => x.Channel == "Booking.com" && x.TotalAmount == 200m)), Times.Once);
    }
}

public class ReportServiceTests
{
    private readonly Mock<IBookingRepository> _bookings = new();
    private readonly Mock<IRoomRepository> _rooms = new();
    private readonly Mock<IHotelRepository> _hotels = new();

    private ReportService Sut() => new(_bookings.Object, _rooms.Object, _hotels.Object,
        new Mock<IGuestRepository>().Object, new Mock<IRoomTypeRepository>().Object);

    [Fact]
    public async Task Occupancy_WithNoBookings_IsZeroPercent()
    {
        _bookings.Setup(b => b.ListOverlappingAsync(null, It.IsAny<DateOnly>(), It.IsAny<DateOnly>())).ReturnsAsync(new List<Booking>());
        _rooms.Setup(r => r.CountForHotelAsync(null)).ReturnsAsync(120);
        var report = await Sut().GetOccupancyAsync(null, new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 7));
        Assert.Equal(0m, report.OccupancyPct);
        Assert.Equal(7, report.Days.Count);
    }

    [Fact]
    public async Task AC_56_CheckoutDateIsNotCountedAsAnOccupiedNight()
    {
        var date = new DateOnly(2026, 10, 2);
        _hotels.Setup(h => h.GetAsync(1)).ReturnsAsync(new Hotel { Id = 1 });
        _bookings.Setup(b => b.ListOverlappingAsync(1, date, date)).ReturnsAsync(
            Enumerable.Range(1, 4)
                .Select(id => new Booking
                {
                    Id = id,
                    HotelId = 1,
                    CheckIn = date.AddDays(-1),
                    CheckOut = date
                })
                .Concat(Enumerable.Range(5, 5).Select(id => new Booking
                {
                    Id = id,
                    HotelId = 1,
                    CheckIn = date.AddDays(-1),
                    CheckOut = date.AddDays(1)
                }))
                .ToList());
        _rooms.Setup(r => r.CountForHotelAsync(1)).ReturnsAsync(20);

        var report = await Sut().GetOccupancyAsync(1, date, date);

        Assert.Equal(5, report.RoomNightsSold);
        Assert.Equal(25m, report.OccupancyPct);
        Assert.Equal(5, Assert.Single(report.Days).RoomsSold);
    }

    [Fact]
    public async Task AC_56_WeeklyOccupancyExcludesCheckoutDates()
    {
        var from = new DateOnly(2026, 10, 1);
        var to = new DateOnly(2026, 10, 7);
        _hotels.Setup(h => h.GetAsync(1)).ReturnsAsync(new Hotel { Id = 1 });
        var bookings = Enumerable.Range(1, 3)
            .Select(id => new Booking
            {
                Id = id,
                HotelId = 1,
                CheckIn = from,
                CheckOut = to.AddDays(1)
            })
            .Concat(Enumerable.Range(4, 4).Select(id => new Booking
            {
                Id = id,
                HotelId = 1,
                CheckIn = from,
                CheckOut = from.AddDays(1)
            }))
            .Concat(Enumerable.Range(8, 20).Select(id =>
            {
                var checkIn = from.AddDays(1 + (id - 8) / 4);
                return new Booking
                {
                    Id = id,
                    HotelId = 1,
                    CheckIn = checkIn,
                    CheckOut = checkIn.AddDays(1)
                };
            }))
            .ToList();
        _bookings.Setup(b => b.ListOverlappingAsync(1, from, to)).ReturnsAsync(bookings);
        _rooms.Setup(r => r.CountForHotelAsync(1)).ReturnsAsync(20);

        var report = await Sut().GetOccupancyAsync(1, from, to);

        Assert.Equal(45, report.RoomNightsSold);
        Assert.Equal(32.1m, report.OccupancyPct);
    }

    [Fact]
    public async Task Occupancy_ToBeforeFrom_IsRejected()
    {
        await Assert.ThrowsAsync<BusinessRuleException>(() =>
            Sut().GetOccupancyAsync(null, new DateOnly(2026, 10, 7), new DateOnly(2026, 10, 1)));
    }
}

public class ValidatorAndHasherTests
{
    [Fact]
    public void BookingRequest_CheckOutBeforeCheckIn_IsInvalid()
    {
        var result = new BookingRequestValidator().Validate(
            new BookingRequest(1, 1, 1, 1, new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 3), 2, null));
        Assert.False(result.IsValid);
    }

    [Fact]
    public void BookingNote_OverLimit_IsInvalid()
    {
        var result = new BookingNoteRequestValidator().Validate(new BookingNoteRequest(null, new string('x', 1001)));
        Assert.False(result.IsValid);
    }

    [Fact]
    public void PasswordHasher_VerifiesCorrectPasswordOnly()
    {
        var hash = PasswordHasher.Hash("Correct-Horse-9");
        Assert.True(PasswordHasher.Verify("Correct-Horse-9", hash));
        Assert.False(PasswordHasher.Verify("wrong", hash));
    }
}
