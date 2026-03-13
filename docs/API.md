# OpenHarvest — REST API Reference

> Base URL: `https://api.openharvest.io/api/v1` (production) | `http://localhost:5000/api/v1` (local)
> Authentication: Bearer token (JWT) — obtain via `/auth/login` or OAuth
> All endpoints return `application/json`

---

## Authentication

### Register

```http
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "displayName": "Jane Gardener"
}
```

### Login

```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Response:**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "...",
  "expiresIn": 900
}
```

### OAuth

```http
GET /auth/google   → redirects to Google OAuth
GET /auth/github   → redirects to GitHub OAuth
POST /auth/refresh → exchange refresh token for new access token
```

---

## Crops

### List / Search Crops

```http
GET /crops?q={search}&zone={zone}&sun={sun}&difficulty={difficulty}&tag={tag}&page={page}&limit={limit}
```

| Param | Type | Description |
|---|---|---|
| `q` | string | Text search on common name and scientific name |
| `zone` | int | Filter to crops that grow in this USDA zone |
| `sun` | string | `FullSun`, `PartialShade`, `FullShade` |
| `difficulty` | string | `Beginner`, `Intermediate`, `Expert` |
| `tag` | string | `vegetable`, `herb`, `fruit`, `flower` |
| `page` | int | Default 1 |
| `limit` | int | Default 20, max 100 |

**Example:** `GET /crops?q=tomato&zone=7&difficulty=Beginner`

### Get Crop Detail

```http
GET /crops/{id}
```

Returns full crop detail including companions and known problems.

### Get Companion Planting Info

```http
GET /crops/{id}/companions
```

Returns beneficial and antagonistic companion plants.

---

## Gardens

### Create Garden

```http
POST /gardens
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "Backyard Garden",
  "type": "Backyard",
  "latitude": 39.9526,
  "longitude": -75.1652,
  "areaSqFt": 400
}
```

Zone, last frost date, and first frost date are auto-populated from coordinates.

### List User's Gardens

```http
GET /gardens
Authorization: Bearer {token}
```

### Get Garden

```http
GET /gardens/{id}
Authorization: Bearer {token}
```

### Get Planting Calendar

```http
GET /gardens/{id}/calendar
Authorization: Bearer {token}
```

Returns an AI-generated, frost-date-aware planting calendar for all crops in this garden. Cached for 24 hours.

---

## Garden Beds & Plantings

### Add a Garden Bed

```http
POST /gardens/{gardenId}/beds
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "North Raised Bed",
  "lengthFt": 8,
  "widthFt": 4,
  "sunExposure": "FullSun",
  "soilType": "Loamy"
}
```

### Record a Planting

```http
POST /gardens/{gardenId}/beds/{bedId}/plantings
Authorization: Bearer {token}
Content-Type: application/json

{
  "cropId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "plantedDate": "2026-04-15",
  "method": "Transplant",
  "quantity": 4,
  "notes": "Started indoors March 1"
}
```

### Log Garden Activity

```http
POST /plantings/{id}/logs
Authorization: Bearer {token}
Content-Type: application/json

{
  "type": "Watered",
  "notes": "Deep watered, 1 gallon each",
  "photoUrl": null
}
```

`type` options: `Watered`, `Fertilized`, `Pruned`, `PestSpotted`, `Diseased`, `Harvested`, `Thinned`, `Transplanted`, `Note`

### Record Harvest

```http
PATCH /plantings/{id}/harvest
Authorization: Bearer {token}
Content-Type: application/json

{
  "harvestedDate": "2026-07-20",
  "yieldLbs": 12.5,
  "notes": "Excellent yield this year"
}
```

---

## AI Endpoints

All AI endpoints require authentication and are rate-limited (20 questions/day, 5 diagnoses/day per user).

### Ask a Gardening Question

```http
POST /ai/ask
Authorization: Bearer {token}
Content-Type: application/json

{
  "question": "Why are my tomato leaves curling inward?",
  "gardenId": "3fa85f64-5717-4562-b3fc-2c963f66afa6"  // optional, for context
}
```

**Response:**
```json
{
  "answer": "Leaf curl in tomatoes can have several causes depending on your conditions...",
  "relatedProblems": [
    { "id": "...", "name": "Physiological Leaf Roll", "url": "/problems/..." }
  ],
  "contextUsed": {
    "zone": 7,
    "season": "Early Summer"
  }
}
```

### Diagnose a Plant Problem

```http
POST /ai/diagnose
Authorization: Bearer {token}
Content-Type: multipart/form-data

photo: [image file]
plantingId: 3fa85f64-5717-4562-b3fc-2c963f66afa6  (optional)
description: "Brown spots appearing on lower leaves"
```

**Response:**
```json
{
  "diagnosisId": "...",
  "diagnosis": "Based on the photo and description, this appears to be early blight...",
  "matchedProblem": {
    "id": "...",
    "name": "Early Blight",
    "organicTreatment": "Remove affected leaves immediately...",
    "prevention": "Avoid overhead watering..."
  },
  "confidence": "High"
}
```

### Get Crop Recommendations

```http
POST /ai/recommend
Authorization: Bearer {token}
Content-Type: application/json

{
  "gardenId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "availableSqFt": 32,
  "sunExposure": "FullSun",
  "experienceLevel": "Beginner",
  "preferences": ["easy", "high-yield", "vegetable"]
}
```

**Response:**
```json
{
  "recommendations": [
    {
      "crop": { "id": "...", "commonName": "Zucchini", "difficulty": "Beginner" },
      "reason": "Extremely productive in zone 7, minimal care needed...",
      "plantingWindow": "May 1 – May 15",
      "expectedYield": "20–30 lbs per plant"
    }
  ]
}
```

---

## Community

### Get Growing Tips

```http
GET /community/tips?zone={zone}&cropId={cropId}&page={page}
```

Returns zone-specific growing tips, sorted by upvotes.

### Post a Growing Tip

```http
POST /community/tips
Authorization: Bearer {token}
Content-Type: application/json

{
  "cropId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "content": "In zone 7b, starting tomatoes indoors by March 1 gives them a full season.",
  "season": 2026
}
```

### Upvote a Tip

```http
POST /community/tips/{id}/upvote
Authorization: Bearer {token}
```

### Post Surplus Harvest

```http
POST /community/shares
Authorization: Bearer {token}
Content-Type: application/json

{
  "cropId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "quantityLbs": 10,
  "description": "10 lbs fresh heirloom tomatoes, mixed varieties",
  "latitude": 39.9526,
  "longitude": -75.1652,
  "expiresAt": "2026-07-25T18:00:00Z"
}
```

### Find Nearby Surplus Food

```http
GET /community/shares?lat={lat}&lng={lng}&radius={miles}&cropId={cropId}
```

Returns available shares within the specified radius, sorted by distance.

### Claim a Share

```http
POST /community/shares/{id}/claim
Authorization: Bearer {token}
```

---

## Error Responses

All errors follow a consistent format:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more validation errors occurred.",
    "details": [
      { "field": "latitude", "message": "Latitude must be between -90 and 90." }
    ]
  }
}
```

| HTTP Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid request data |
| 401 | `UNAUTHORIZED` | Missing or expired token |
| 403 | `FORBIDDEN` | Authenticated but not authorized for this resource |
| 404 | `NOT_FOUND` | Resource does not exist |
| 429 | `RATE_LIMITED` | Too many AI requests today |
| 500 | `INTERNAL_ERROR` | Server error (check logs) |

---

## Pagination

All list endpoints support cursor-based pagination:

```http
GET /crops?page=2&limit=20
```

**Response envelope:**
```json
{
  "data": [...],
  "pagination": {
    "page": 2,
    "limit": 20,
    "total": 450,
    "hasNext": true,
    "hasPrev": true
  }
}
```

---

*API versioning: Breaking changes increment the version (`/api/v2/`). Non-breaking additions may be added to existing versions.*
