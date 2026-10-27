using FluentValidation;
using Larchmont.Api.Domain;
using Larchmont.Api.Dtos;

namespace Larchmont.Api.Validators;

public class RoomTransitionRequestValidator : AbstractValidator<RoomTransitionRequest>
{
    public RoomTransitionRequestValidator()
    {
        RuleFor(x => x.To)
            .NotEmpty().WithMessage("Say which state the room should move to.")
            .Must(to => to != null && RoomStatuses.All.Contains(to))
            .WithMessage($"Unknown state. Use one of: {string.Join(", ", RoomStatuses.All)}.");
        RuleFor(x => x.Reason).MaximumLength(255);
        When(x => x.To == RoomStatuses.OutOfOrder, () =>
        {
            RuleFor(x => x.Reason)
                .Must(r => !string.IsNullOrWhiteSpace(r))
                .WithMessage("A reason is required to move a room out of order.");
        });
        When(x => x.To != RoomStatuses.OutOfOrder, () =>
        {
            RuleFor(x => x.ExpectedReturnAt)
                .Null()
                .WithMessage("An expected return time is only allowed when moving a room out of order.");
        });
    }
}

public class OutOfOrderRequestValidator : AbstractValidator<OutOfOrderRequest>
{
    public OutOfOrderRequestValidator()
    {
        RuleFor(x => x.Reason)
            .Must(r => !string.IsNullOrWhiteSpace(r))
            .WithMessage("A reason is required to move a room out of order.")
            .MaximumLength(255);
    }
}

public class RoomStatusRequestValidator : AbstractValidator<RoomStatusRequest>
{
    public RoomStatusRequestValidator()
    {
        RuleFor(x => x.Status)
            .Must(s => s != null && RoomStatuses.All.Contains(s))
            .WithMessage($"Status must be one of: {string.Join(", ", RoomStatuses.All)}.");
    }
}

public class LockCheckoutRequestValidator : AbstractValidator<LockCheckoutRequest>
{
    public LockCheckoutRequestValidator()
    {
        RuleFor(x => x.BookingRef).NotEmpty().MaximumLength(20);
        RuleFor(x => x.RoomId).GreaterThan(0);
        RuleFor(x => x.CheckedOutAt).NotNull().WithMessage("checkedOutAt is required.");
    }
}

public class FloorAssignmentsRequestValidator : AbstractValidator<FloorAssignmentsRequest>
{
    public FloorAssignmentsRequestValidator()
    {
        RuleFor(x => x.Assignments).NotNull().WithMessage("assignments is required.");
        RuleForEach(x => x.Assignments!).ChildRules(item =>
        {
            item.RuleFor(a => a.Floor).InclusiveBetween(0, 60);
            item.RuleFor(a => a.HousekeeperId).GreaterThan(0);
        }).When(x => x.Assignments != null);
        RuleFor(x => x.Assignments)
            .Must(list => list == null || list.Select(a => a.Floor).Distinct().Count() == list.Count)
            .WithMessage("A floor appears more than once. Each floor can have one housekeeper.")
            .When(x => x.Assignments != null);
    }
}

public class AssignHousekeeperFloorsRequestValidator : AbstractValidator<AssignHousekeeperFloorsRequest>
{
    public AssignHousekeeperFloorsRequestValidator()
    {
        RuleFor(x => x.HotelId).GreaterThan(0);
        RuleFor(x => x.Floors)
            .NotNull().WithMessage("floors is required.")
            .Must(f => f == null || f.Count > 0).WithMessage("Give at least one floor.")
            .Must(f => f == null || f.Distinct().Count() == f.Count).WithMessage("A floor is listed more than once.")
            .Must(f => f == null || f.All(x => x >= 0 && x <= 60)).WithMessage("Floor must be between 0 and 60.");
    }
}
