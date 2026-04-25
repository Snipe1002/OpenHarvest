FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY OpenHarvest.sln ./
COPY src/OpenHarvest.Domain/OpenHarvest.Domain.csproj src/OpenHarvest.Domain/
COPY src/OpenHarvest.Application/OpenHarvest.Application.csproj src/OpenHarvest.Application/
COPY src/OpenHarvest.Infrastructure/OpenHarvest.Infrastructure.csproj src/OpenHarvest.Infrastructure/
COPY src/OpenHarvest.API/OpenHarvest.API.csproj src/OpenHarvest.API/
COPY src/OpenHarvest.Worker/OpenHarvest.Worker.csproj src/OpenHarvest.Worker/
RUN dotnet restore src/OpenHarvest.API/OpenHarvest.API.csproj

COPY src/ src/
RUN dotnet publish src/OpenHarvest.API/OpenHarvest.API.csproj -c Release -o /app /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /app ./
EXPOSE 5000
ENV ASPNETCORE_URLS=http://+:5000
ENTRYPOINT ["dotnet", "OpenHarvest.API.dll"]
