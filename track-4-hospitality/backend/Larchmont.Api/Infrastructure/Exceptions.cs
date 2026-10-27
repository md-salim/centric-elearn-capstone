using FluentValidation;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace Larchmont.Api.Infrastructure;

public class NotFoundException : Exception
{
    public NotFoundException(string message) : base(message) { }
}

public class ConflictException : Exception
{
    public ConflictException(string message) : base(message) { }
}

public class BusinessRuleException : Exception
{
    public BusinessRuleException(string message) : base(message) { }
}

/// <summary>An illegal room state move (BR-03). Maps to 400, not the 422 used by other business rules.</summary>
public class InvalidTransitionException : Exception
{
    public InvalidTransitionException(string message) : base(message) { }
}

/// <summary>A well-formed request that cannot be applied (for example a housekeeper not in this hotel). Maps to 400.</summary>
public class InvalidRequestException : Exception
{
    public InvalidRequestException(string message) : base(message) { }
}

/// <summary>A caller that failed the webhook signature check. Maps to 401. The message never carries the secret.</summary>
public class UnauthorizedException : Exception
{
    public UnauthorizedException(string message) : base(message) { }
}

public class ApiExceptionHandler : IExceptionHandler
{
    private readonly ILogger<ApiExceptionHandler> _logger;

    public ApiExceptionHandler(ILogger<ApiExceptionHandler> logger) => _logger = logger;

    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken ct)
    {
        ProblemDetails problem;
        switch (exception)
        {
            case ValidationException ve:
                problem = new ValidationProblemDetails(
                    ve.Errors.GroupBy(e => e.PropertyName)
                        .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorMessage).ToArray()))
                { Status = 400, Title = "Validation failed" };
                break;
            case InvalidTransitionException it:
                problem = new ProblemDetails { Status = 400, Title = "Invalid transition", Detail = it.Message };
                break;
            case InvalidRequestException ir:
                problem = new ProblemDetails { Status = 400, Title = "Invalid request", Detail = ir.Message };
                break;
            case UnauthorizedException:
                problem = new ProblemDetails { Status = 401, Title = "Unauthorized", Detail = "The request signature is missing or invalid." };
                break;
            case NotFoundException nf:
                problem = new ProblemDetails { Status = 404, Title = "Not found", Detail = nf.Message };
                break;
            case ConflictException c:
                problem = new ProblemDetails { Status = 409, Title = "Conflict", Detail = c.Message };
                break;
            case BusinessRuleException br:
                problem = new ProblemDetails { Status = 422, Title = "Rule violated", Detail = br.Message };
                break;
            default:
                _logger.LogError(exception, "Unhandled error on {Path}", context.Request.Path);
                problem = new ProblemDetails { Status = 500, Title = "Unexpected error" };
                break;
        }
        context.Response.StatusCode = problem.Status!.Value;
        // The contract says every error is ProblemDetails (application/problem+json), not plain JSON.
        await context.Response.WriteAsJsonAsync(problem, options: null, contentType: "application/problem+json", cancellationToken: ct);
        return true;
    }
}
