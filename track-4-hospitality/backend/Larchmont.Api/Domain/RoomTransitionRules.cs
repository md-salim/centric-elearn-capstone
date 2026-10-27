namespace Larchmont.Api.Domain;

/// <summary>
/// The legal moves between room states (BR-02). Pure: no I/O, no clock.
/// Any move not listed here, including a move to the room's own state, is refused (BR-03).
/// </summary>
public static class RoomTransitionRules
{
    private static readonly IReadOnlyDictionary<string, string[]> Moves = new Dictionary<string, string[]>
    {
        [RoomStatuses.Dirty] = new[] { RoomStatuses.Cleaning, RoomStatuses.OutOfOrder },
        [RoomStatuses.Cleaning] = new[] { RoomStatuses.Inspected, RoomStatuses.Ready, RoomStatuses.OutOfOrder },
        [RoomStatuses.Inspected] = new[] { RoomStatuses.Ready, RoomStatuses.OutOfOrder },
        [RoomStatuses.Ready] = new[] { RoomStatuses.OutOfOrder },
        [RoomStatuses.OutOfOrder] = new[] { RoomStatuses.Dirty },
    };

    public static IReadOnlyList<string> AllowedFrom(string status) =>
        Moves.TryGetValue(status, out var targets) ? targets : Array.Empty<string>();

    public static bool IsAllowed(string from, string to) => AllowedFrom(from).Contains(to);

    /// <summary>A housekeeper moving Cleaning straight to Ready. Sets the SelfMarked flag (BR-04).</summary>
    public static bool IsSelfMark(string from, string to) =>
        from == RoomStatuses.Cleaning && to == RoomStatuses.Ready;

    /// <summary>The message the front desk sees for a refused move. Names the current state and the allowed moves.</summary>
    public static string Refusal(string roomNumber, string from, string to)
    {
        var allowed = AllowedFrom(from);
        var options = allowed.Count == 0 ? "make no further moves" : "only go to " + JoinOr(allowed);
        return to == from
            ? $"Room {roomNumber} is already {from}. It can {options}."
            : $"Room {roomNumber} is {from}. It can {options}.";
    }

    private static string JoinOr(IReadOnlyList<string> items) =>
        items.Count == 1 ? items[0] : $"{string.Join(", ", items.Take(items.Count - 1))} or {items[^1]}";
}
