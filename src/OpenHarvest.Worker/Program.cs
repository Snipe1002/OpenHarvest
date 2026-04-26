using OpenHarvest.Worker;

var builder = Host.CreateApplicationBuilder(args);

var apiBase = builder.Configuration["Worker:ApiBaseUrl"]
    ?? "http://api:5000"; // default container DNS name
builder.Services.AddHttpClient("api", client =>
{
    client.BaseAddress = new Uri(apiBase);
    client.Timeout = TimeSpan.FromSeconds(30);
});

builder.Services.AddHostedService<NudgeScanWorker>();

var host = builder.Build();
host.Run();
