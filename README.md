# OpenHarvest

> **Open-Source AI-Powered Gardening Platform**
> Make growing food accessible to everyone through AI-powered guidance, open data, and community knowledge.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![.NET](https://img.shields.io/badge/.NET-8%2B-purple)](https://dotnet.microsoft.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Open Source](https://img.shields.io/badge/Open%20Source-%E2%9D%A4-red)](https://github.com/Snipe1002/OpenHarvest)

---

## What is OpenHarvest?

OpenHarvest is a free, open-source platform that uses AI to make growing food accessible to anyone — whether you have a backyard, a balcony, or just a windowsill.

It is the **spiritual successor to OpenFarm** (2014–2025), which shut down in April 2025 after a decade of operation. OpenHarvest learns from OpenFarm's architectural failures and rebuilds the concept with:

- **AI-generated, personalized guidance** instead of crowdsourced wiki articles
- **Active engagement loops** (planting calendars, reminders, progress tracking) instead of a passive reference site
- **Modern, containerized .NET 8+ stack** instead of a rotting Ruby/Rails + MongoDB codebase
- **Passive user contribution** — every garden logged makes the platform smarter for everyone

---

## The Problem We Solve

World hunger is primarily a **distribution and knowledge problem**, not a production problem. We already grow enough calories globally. What's missing is localized knowledge: people don't know what to grow, when to plant, or how to diagnose problems.

OpenHarvest puts an AI-powered master gardener in everyone's pocket, **for free**.

---

## Key Features

| Feature | Description |
|---|---|
| **Crop Database** | Structured, AI-queryable knowledge base seeded from OpenFarm's CC0 data |
| **Personalized Gardens** | Multi-garden support with zone-aware, season-aware recommendations |
| **AI Q&A** | Natural-language gardening questions answered with your specific context |
| **Visual Diagnosis** | Photo-based plant disease identification with organic treatment suggestions |
| **Planting Calendar** | AI-generated season calendar with frost-date-aware scheduling |
| **Smart Reminders** | Push notifications for time-sensitive garden tasks |
| **Community Tips** | Zone-specific growing tips shared by local gardeners |
| **Harvest Sharing** | Post surplus produce for neighbors to claim (local food network) |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend API | ASP.NET Core 8+ / C# |
| Database | PostgreSQL + Entity Framework Core |
| Caching | Redis |
| AI Integration | Pluggable `IAiProvider` — Claude, OpenAI, or Ollama (self-hosted) |
| Web Frontend | Blazor WASM or React |
| Mobile | .NET MAUI (Android + iOS) |
| Background Jobs | Hangfire / .NET BackgroundService |
| Auth | ASP.NET Identity + OAuth (Google, GitHub) |
| Containerization | Docker + docker-compose |

---

## Quick Start

### Prerequisites

- [.NET 8 SDK](https://dotnet.microsoft.com/download)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- An AI API key (Claude, OpenAI) — or run [Ollama](https://ollama.ai/) locally for free

### One-Command Setup

```bash
git clone https://github.com/Snipe1002/OpenHarvest.git
cd OpenHarvest
docker-compose up
```

The API will be available at `http://localhost:5000` and the web frontend at `http://localhost:3000`.

### Manual Setup

```bash
# Clone the repo
git clone https://github.com/Snipe1002/OpenHarvest.git
cd OpenHarvest

# Start dependencies
docker-compose up -d postgres redis

# Set your AI provider key
export AI_PROVIDER=claude
export CLAUDE_API_KEY=your_key_here

# Run database migrations and seed crop data
dotnet ef database update --project src/OpenHarvest.Infrastructure

# Start the API
dotnet run --project src/OpenHarvest.API

# Start the web frontend (in a separate terminal)
cd src/OpenHarvest.Web && dotnet run
```

---

## Project Structure

```
OpenHarvest/
├── src/
│   ├── OpenHarvest.Domain/           # Entities, enums, interfaces
│   ├── OpenHarvest.Application/       # Use cases, DTOs, validation
│   ├── OpenHarvest.Infrastructure/    # EF Core, AI providers, external APIs
│   ├── OpenHarvest.API/               # ASP.NET Core Web API
│   ├── OpenHarvest.Web/               # Blazor WASM / React frontend
│   └── OpenHarvest.Mobile/            # .NET MAUI mobile app
├── tests/
│   ├── OpenHarvest.Domain.Tests/
│   ├── OpenHarvest.Application.Tests/
│   └── OpenHarvest.API.Tests/
├── docs/                              # Architecture, API, setup guides
├── seed-data/                         # Initial crop database (OpenFarm CC0)
├── docker-compose.yml
└── README.md
```

---

## Development Roadmap

| Phase | Focus | Timeline |
|---|---|---|
| **Phase 1** | Crop database + AI Q&A | Weeks 1–4 |
| **Phase 2** | User gardens + planting calendars | Weeks 5–8 |
| **Phase 3** | Visual diagnosis + activity logging | Weeks 9–12 |
| **Phase 4** | Community tips + harvest sharing | Weeks 13–16 |
| **Phase 5** | Mobile app, offline mode, IoT, i18n | Ongoing |

See [ROADMAP.md](ROADMAP.md) for the full detailed roadmap.

---

## Why OpenHarvest Succeeds Where Others Failed

**vs. OpenFarm:** OpenFarm was a static wiki requiring experts to write content. OpenHarvest generates personalized, AI-powered guidance dynamically. Users contribute data passively just by gardening.

**vs. FarmBot:** FarmBot requires $500–$3000+ of hardware. OpenHarvest needs only a phone or browser. They are complementary — OpenHarvest can serve as FarmBot's new knowledge backend.

**vs. Paid Apps (Gardenly, Planta):** Those are subscription-based, closed-source, and focused on houseplant aesthetics. OpenHarvest is free, open-source, and focused on food production.

---

## The Flywheel

```
More Users → More Planting Data → Better AI Recommendations
    ↑                                          ↓
More Shared Surplus ← Better Harvests ←───────┘
```

Each user makes the system smarter for everyone. The data stays public. The knowledge compounds.

---

## Contributing

OpenHarvest is actively seeking contributors. Whether you're a .NET developer, a frontend engineer, a gardening expert, or someone passionate about food security — there's a place for you here.

Read the [Contributing Guide](CONTRIBUTING.md) to get started.

---

## License

MIT — free to use, modify, and distribute. The crop seed data is licensed CC0 (Public Domain) from OpenFarm.

---

## Links

- [System Design Document](docs/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [Data Model](docs/DATA_MODEL.md)
- [AI Integration Guide](docs/AI_INTEGRATION.md)
- [Getting Started for Developers](docs/GETTING_STARTED.md)
- [Research & References](docs/REFERENCES.md)

---

*Let's grow something.*
