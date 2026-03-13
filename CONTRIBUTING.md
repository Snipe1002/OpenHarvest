# Contributing to OpenHarvest

First off — thank you. OpenHarvest exists because people care about food access, open knowledge, and open-source software. Every contribution, no matter how small, moves that mission forward.

---

## Ways to Contribute

You don't have to write code. We need:

- **.NET / C# developers** — backend API, EF Core, services
- **Frontend developers** — Blazor WASM or React
- **Mobile developers** — .NET MAUI
- **Gardening experts** — review crop data accuracy, suggest missing information
- **Writers** — improve docs, translate content
- **Designers** — UX, icons, garden layout tools
- **Testers** — find bugs, write tests, validate AI responses
- **Data contributors** — help curate and expand the crop database

---

## Getting Started

### 1. Fork and Clone

```bash
git clone https://github.com/Snipe1002/OpenHarvest.git
cd OpenHarvest
```

### 2. Set Up the Development Environment

**Requirements:**
- [.NET 8 SDK](https://dotnet.microsoft.com/download)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for PostgreSQL + Redis)
- An AI API key, OR [Ollama](https://ollama.ai/) running locally (free, no API key needed)

**Start dependencies:**
```bash
docker-compose up -d postgres redis
```

**Configure your environment:**
```bash
cp appsettings.Development.json.example appsettings.Development.json
# Edit the file to add your AI API key and other local settings
```

**Run migrations:**
```bash
dotnet ef database update --project src/OpenHarvest.Infrastructure
```

**Start the API:**
```bash
dotnet run --project src/OpenHarvest.API
```

### 3. Find Something to Work On

- Browse [open issues](https://github.com/Snipe1002/OpenHarvest/issues) tagged `good first issue` or `help wanted`
- Check [ROADMAP.md](ROADMAP.md) for planned work
- If you have an idea not on the roadmap, [open a discussion](https://github.com/Snipe1002/OpenHarvest/discussions) first

---

## Development Workflow

### Branching

```
main          — stable, always deployable
dev           — integration branch for next release
feature/*     — new features (branch from dev)
fix/*         — bug fixes (branch from dev or main)
docs/*        — documentation only
```

### Making a Change

```bash
# Create a branch
git checkout dev
git pull origin dev
git checkout -b feature/your-feature-name

# Make changes, then commit
git add -p   # stage changes interactively
git commit -m "feat: brief description of what and why"

# Push and open a PR
git push origin feature/your-feature-name
```

### Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add AI crop recommendation endpoint
fix: correct frost date calculation for southern hemisphere
docs: expand AI integration guide
test: add unit tests for GardenService
chore: update EF Core to 8.0.3
```

---

## Code Standards

### C# / .NET

- Target `.NET 8` and use modern C# features where they improve clarity
- Follow [Microsoft's C# coding conventions](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/coding-style/coding-conventions)
- Use `async/await` throughout — no `.Result` or `.Wait()` calls
- All public methods should have XML doc comments
- New services must be registered in DI and follow `I{Name}` / `{Name}` convention

### Architecture

- **Domain** layer has zero dependencies on Infrastructure or Application
- **Application** layer depends only on Domain
- **Infrastructure** implements interfaces defined in Domain
- **API** depends on Application and Infrastructure (via DI)

### AI Provider

- All AI calls go through `IAiProvider` — never call Claude/OpenAI SDK directly from services
- Always pass full `GardenContext` — never let AI respond without user context
- Log AI request/response pairs (stripped of PII) for debugging

### Testing

- Unit tests for all service layer logic
- Integration tests for API endpoints (using `WebApplicationFactory`)
- AI provider calls should be mockable via the `IAiProvider` interface
- Tests live in the `tests/` folder, mirroring the `src/` structure

---

## Pull Request Checklist

Before opening a PR:

- [ ] Code builds without warnings (`dotnet build`)
- [ ] All existing tests pass (`dotnet test`)
- [ ] New tests written for new logic
- [ ] No hardcoded API keys or secrets
- [ ] `appsettings.Development.json` is in `.gitignore` and not committed
- [ ] PR description explains *what* changed and *why*
- [ ] Relevant docs updated if behavior changed

---

## Crop Data Contributions

The crop database is the heart of OpenHarvest. If you know gardening:

- Submit corrections or additions via issues or PRs to `seed-data/`
- All crop data should be verifiable from reputable horticultural sources
- Source your additions (university extension services, RHS, USDA, etc.)
- Data is published CC0 — contributions to the crop database must be original or from public domain sources

---

## Community Standards

We follow the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/). In short:

- Be kind and constructive
- Assume good intent
- Disagreements about code are fine; personal attacks are not
- Gardening is a peaceful pursuit — keep the project that way

---

## Questions?

- **Bugs / features:** [Open an issue](https://github.com/Snipe1002/OpenHarvest/issues)
- **Ideas / discussion:** [Start a discussion](https://github.com/Snipe1002/OpenHarvest/discussions)
- **Security issues:** Please report privately — do not open public issues for vulnerabilities

---

*Thank you for helping make food knowledge free and accessible to everyone.*
