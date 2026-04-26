using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using OpenHarvest.API.Hubs;
using OpenHarvest.Infrastructure;
using OpenHarvest.Infrastructure.Data;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers().AddJsonOptions(o =>
{
    o.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    o.JsonSerializerOptions.DictionaryKeyPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddOpenHarvestInfrastructure(builder.Configuration);

builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()
    .SetIsOriginAllowed(_ => true)));

// Rate limiter — protects the advisor endpoints from runaway costs. Per-IP for now;
// once auth lands the partition key becomes the user id.
//
// "advisor": chat / calendar / status — 30/min + 200/hour per IP.
// "advisor-vision": photo diagnosis (more expensive) — 6/min + 40/hour per IP.
//
// The 200/hour and 40/hour caps catch slow-drip abuse that the per-minute limit misses.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    options.AddPolicy("advisor", ctx => RateLimitPartition.GetSlidingWindowLimiter(
        partitionKey: ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        factory: _ => new SlidingWindowRateLimiterOptions
        {
            PermitLimit = 30,
            Window = TimeSpan.FromMinutes(1),
            SegmentsPerWindow = 6,
            QueueLimit = 0,
        }));

    options.AddPolicy("advisor-hourly", ctx => RateLimitPartition.GetFixedWindowLimiter(
        partitionKey: ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        factory: _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 200,
            Window = TimeSpan.FromHours(1),
            QueueLimit = 0,
        }));

    options.AddPolicy("advisor-vision", ctx => RateLimitPartition.GetSlidingWindowLimiter(
        partitionKey: ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        factory: _ => new SlidingWindowRateLimiterOptions
        {
            PermitLimit = 6,
            Window = TimeSpan.FromMinutes(1),
            SegmentsPerWindow = 6,
            QueueLimit = 0,
        }));

    options.AddPolicy("advisor-vision-hourly", ctx => RateLimitPartition.GetFixedWindowLimiter(
        partitionKey: ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        factory: _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 40,
            Window = TimeSpan.FromHours(1),
            QueueLimit = 0,
        }));

    options.OnRejected = async (context, ct) =>
    {
        context.HttpContext.Response.Headers["Retry-After"] = "60";
        await context.HttpContext.Response.WriteAsJsonAsync(new
        {
            error = "rate-limited",
            message = "You've made too many advisor requests. Try again in a moment.",
        }, ct);
    };
});

var signalR = builder.Services.AddSignalR()
    .AddJsonProtocol(o =>
    {
        o.PayloadSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
        o.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    });

var redisConn = builder.Configuration.GetConnectionString("Redis");
if (!string.IsNullOrWhiteSpace(redisConn))
{
    signalR.AddStackExchangeRedis(redisConn);
}

builder.Services.AddSingleton<GardenBroadcaster>();

var app = builder.Build();

// Optional path-base prefix — lets the app live at e.g. /openharvest/ behind a reverse
// proxy that does NOT strip the prefix. Off by default (empty string). Set
// OpenHarvest__PathBase=/openharvest (env var) or "OpenHarvest:PathBase" (config) to
// enable. When the proxy already strips the prefix (e.g. Caddy `handle_path`), leave
// this unset — the static `<base href="./">` in index.html handles client-side resolution.
var pathBase = builder.Configuration["OpenHarvest:PathBase"];
if (!string.IsNullOrWhiteSpace(pathBase))
{
    if (!pathBase.StartsWith('/')) pathBase = "/" + pathBase;
    pathBase = pathBase.TrimEnd('/');
    app.UsePathBase(pathBase);
    // Echo the prefix so a static index.html can read it if it ever needs to (debug aid).
    app.MapGet("/__pathbase", () => Results.Json(new { pathBase }));
}

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<OpenHarvestDbContext>();
    await db.Database.MigrateAsync();
    await DatabaseSeeder.SeedAsync(db);
    await CropSeeder.SeedAsync(db);
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseDefaultFiles();
app.UseStaticFiles();

app.UseCors();
app.UseRateLimiter();

app.MapControllers();
app.MapHub<GardenHub>("/hubs/garden");

app.MapGet("/healthz", () => Results.Ok(new { status = "ok", service = "openharvest-api" }));

app.Run();
