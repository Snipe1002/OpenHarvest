# Getting Started — Developer Setup Guide

> This guide gets OpenHarvest running locally in under 10 minutes.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| .NET SDK | 8.0+ | [dotnet.microsoft.com](https://dotnet.microsoft.com/download) |
| Docker Desktop | Latest | [docker.com](https://www.docker.com/products/docker-desktop/) |
| Git | Any | [git-scm.com](https://git-scm.com/) |
| An editor | Any | VS Code, Rider, or Visual Studio |

**AI Provider** (pick one):
- **Claude API key** from [console.anthropic.com](https://console.anthropic.com) — recommended for production
- **OpenAI API key** from [platform.openai.com](https://platform.openai.com)
- **Ollama** installed locally — free, no API key needed (see below)

---

## Option A — One Command (Recommended)

```bash
git clone https://github.com/Snipe1002/OpenHarvest.git
cd OpenHarvest
cp .env.example .env
# Edit .env to add your AI API key (see instructions in the file)
docker-compose up
```

This starts:
- PostgreSQL on port `5432`
- Redis on port `6379`
- The API on `http://localhost:5000`
- The web frontend on `http://localhost:3000`
- Swagger UI on `http://localhost:5000/swagger`

The database is automatically migrated and seeded with crop data on first run.

---

## Option B — Manual Setup

### 1. Clone the Repository

```bash
git clone https://github.com/Snipe1002/OpenHarvest.git
cd OpenHarvest
```

### 2. Start Infrastructure

```bash
docker-compose up -d postgres redis
```

Wait ~5 seconds for PostgreSQL to initialize.

### 3. Configure the Application

```bash
# Copy the example config
cp src/OpenHarvest.API/appsettings.Development.json.example \
   src/OpenHarvest.API/appsettings.Development.json
```

Edit `appsettings.Development.json`:

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Host=localhost;Port=5432;Database=openharvest;Username=openharvest;Password=openharvest"
  },
  "Redis": {
    "ConnectionString": "localhost:6379"
  },
  "AI": {
    "Provider": "claude",
    "Claude": {
      "ApiKey": "YOUR_CLAUDE_API_KEY_HERE"
    }
  },
  "Weather": {
    "OpenWeatherMapApiKey": "YOUR_OWM_KEY_HERE"
  },
  "Jwt": {
    "Secret": "generate-a-long-random-string-here",
    "ExpiryMinutes": 15
  }
}
```

### 4. Run Database Migrations

```bash
dotnet ef database update --project src/OpenHarvest.Infrastructure --startup-project src/OpenHarvest.API
```

This runs all migrations and seeds the crop database from `seed-data/`.

### 5. Start the API

```bash
dotnet run --project src/OpenHarvest.API
```

API is now available at `http://localhost:5000`
Swagger UI: `http://localhost:5000/swagger`

### 6. Start the Web Frontend

Open a new terminal:

```bash
# Blazor WASM
dotnet run --project src/OpenHarvest.Web

# OR if using React
cd src/OpenHarvest.Web
npm install
npm run dev
```

---

## Using Ollama (Free, No API Key)

If you don't have an AI API key, run a local model instead:

### Install Ollama

**Windows / macOS:** Download from [ollama.ai](https://ollama.ai)

**Linux:**
```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

### Pull Models

```bash
# Text model for Q&A and recommendations
ollama pull llama3

# Vision model for plant diagnosis
ollama pull llava
```

### Configure OpenHarvest to Use Ollama

In `appsettings.Development.json`:
```json
{
  "AI": {
    "Provider": "ollama",
    "Ollama": {
      "BaseUrl": "http://localhost:11434",
      "TextModel": "llama3",
      "VisionModel": "llava"
    }
  }
}
```

---

## Free API Keys

| Service | Used For | Free Tier |
|---|---|---|
| [OpenWeatherMap](https://openweathermap.org/api) | Frost dates, weather context | 1,000 calls/day |
| [Claude (Anthropic)](https://console.anthropic.com) | AI Q&A, diagnosis | Pay-as-you-go (very cheap) |
| [OpenAI](https://platform.openai.com) | Alternative AI provider | Pay-as-you-go |

Weather data is cached in Redis for 6 hours to minimize API calls.

---

## Running Tests

```bash
# All tests
dotnet test

# Specific project
dotnet test tests/OpenHarvest.Application.Tests

# With coverage
dotnet test --collect:"XPlat Code Coverage"
```

---

## Viewing the Database

A visual DB client isn't required, but these are recommended:

- **TablePlus** (macOS/Windows) — free tier available
- **pgAdmin** — free, included in many Docker setups
- **DBeaver** — free, cross-platform

Connection details (local dev):
```
Host:     localhost
Port:     5432
Database: openharvest
Username: openharvest
Password: openharvest
```

---

## Common Issues

### `No such host: postgres`

The API can't find PostgreSQL. Make sure Docker Compose is running:
```bash
docker-compose up -d postgres redis
docker-compose ps  # should show both as "Up"
```

### `AI provider returned an error`

Check your API key in `appsettings.Development.json`. For Claude, ensure the key starts with `sk-ant-`.

### `Migration failed`

Make sure the `dotnet-ef` tool is installed:
```bash
dotnet tool install --global dotnet-ef
```

Then re-run the migration command.

### Port conflicts

If ports 5000, 5432, or 6379 are in use, edit `docker-compose.yml` to map to different local ports.

---

## Project Structure Quick Reference

| Path | What lives here |
|---|---|
| `src/OpenHarvest.Domain/` | Entities, interfaces, enums — no dependencies |
| `src/OpenHarvest.Application/` | Business logic, DTOs, validators |
| `src/OpenHarvest.Infrastructure/` | Database, AI providers, weather API |
| `src/OpenHarvest.API/` | Controllers, middleware, Program.cs |
| `src/OpenHarvest.Web/` | Blazor/React frontend |
| `tests/` | Unit and integration tests |
| `seed-data/` | Crop database JSON (OpenFarm CC0) |
| `docs/` | All documentation |

---

*Questions? Open an issue or start a discussion on GitHub.*
