using System.Text.Json.Serialization;
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

// SignalR. Use Redis backplane when configured (mandatory once the API scales past one
// replica — without it, two clients on different replicas never see each other's edits).
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

app.MapControllers();
app.MapHub<GardenHub>("/hubs/garden");

app.MapGet("/healthz", () => Results.Ok(new { status = "ok", service = "openharvest-api" }));

app.Run();
