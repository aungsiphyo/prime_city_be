# Smart Residential / Smart City

A monorepo containing a Node.js backend and a React Native mobile app for a smart residential / smart city system.

## Contents

- `Node_Backend/` — Express backend and APIs.
- `Smart_city_Mobile/` — React Native mobile app (iOS & Android).
- `docker-compose.yml` — Docker Compose configuration to run services locally.

## Prerequisites

- macOS (Intel or Apple Silicon)
- Docker Desktop (preferred) or Docker Engine + Docker Compose
- Node.js (for local development) — recommended: v18+ (check `Smart_city_Mobile` engine requirement)
- Yarn or npm

## Quick start (recommended: Docker Compose)

From the project root:

```bash
cd /Users/phyomyatmin/Desktop/smart_residential
# Build and start all services in the background
docker compose up --build -d

# View logs
docker compose logs -f

# Stop and remove containers created by compose
docker compose down
```

Note: if your system uses the legacy CLI, replace `docker compose` with `docker-compose`.

## Backend (Node_Backend)

Location: `Node_Backend/`

Install & run locally:

# Smart Residential / Smart City

A monorepo implementing a smart residential / smart city platform. This repository contains:

- a Node.js backend API server that manages users, visitors, parking, notifications, services, and IoT integrations;
- a React Native mobile app used by residents and guards to view announcements, register visitors, report issues, and receive notifications;
- helper code and IoT integration for an ESP32-CAM QR scanner and MQTT device communication.

## Project Description

This project aims to provide a compact, deployable smart-residential system with features frequently required by apartment/condo management:

- Visitor registration and QR-based entry (ESP32 camera + backend QR generation/validation)
- Parking management and visitor parking tracking
- Resident and admin announcements, advertisements, and service bills
- SOS alerts and real-time notifications via Socket.IO and MQTT
- Helper/maintenance request flow and reporting
- Optional AI integration hooks (OLLAMA configuration variables present) for assistant features

Components

- Backend: Express + Mongoose (MongoDB). Authentication via JWT. Realtime via Socket.IO. MQTT client included for device messaging.
- Mobile: React Native app (Android/iOS) that hits backend REST APIs and subscribes to realtime notifications.
- Device: ESP32-CAM sketch (`Node_Backend/esp32_cam_qr_scanner.ino`) scans QR codes and communicates with the backend / MQTT broker.

Architecture (high level)

Resident Mobile <--> REST API (Express) <--> MongoDB
^
|-- Socket.IO (push notifications)
|-- MQTT client (device messages)
|-- External services: SMTP (nodemailer), Twilio (SMS)

## Features (summary)

- Authentication (login/register) and role-based access
- Visitor QR creation and validation
- MQTT-based IoT communication and device control
- Realtime notifications for SOS and other events
- CRUD for rooms, service bills, announcements, advertisements, helpers
- Admin routes for management

## API endpoints (examples)

- `POST /api/auth/login` — authenticate user
- `POST /api/visitor` — register a visitor
- `GET /api/parking` — parking status
- `POST /api/sos` — send SOS alert
- `GET /api/notifications` — list notifications

(See `Node_Backend/src/routes/` for full route list such as `auth.js`, `visitor.js`, `parking.js`, `sos.js`, `notification.js`, `announcement.js`, `advertisementRoutes.js`, etc.)

## Environment variables (safe guidance)

The backend reads configuration from `Node_Backend/.env`. Do NOT commit secrets to git. Create a `.env` file locally using the variable names below with your values:

- `MONGO_URI` — MongoDB connection string
- `JWT_SECRET` — JWT signing secret
- `REFRESH_SECRET` — refresh token secret
- `EMAIL_USER` / `EMAIL_PASS` — SMTP credentials for sending email
- `MQTT_URL`, `MQTT_USER`, `MQTT_PASS` — MQTT broker details
- `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_MS` — (optional) AI integration
- `OLLAMA_NUM_CTX`, `OLLAMA_NUM_PREDICT`, `OLLAMA_TEMPERATURE` — (optional) AI speed/quality tuning
- `OLLAMA_THINK` — (optional) set `true` only if you want thinking-mode output; default is off for faster chat replies
- `AI_HISTORY_LIMIT`, `AI_RAG_MAX_DOCS`, `AI_RAG_MAX_CHARS` — (optional) prompt-size tuning
- `AI_REQUIRE_AUTH` — (optional) set `true` in production to require JWT for `/api/ai/chat`
- `AI_RATE_LIMIT_ENABLED`, `AI_RATE_LIMIT_MAX`, `AI_RATE_LIMIT_WINDOW_MS` — (optional) AI chat rate-limit controls
- `AI_SYSTEM_PROMPT`, `AI_RESPONSE_STYLE_PROMPT` — (optional) system prompts for AI

Create a `.env.example` (without values) and add it to the repo to document variables.

## How to run (developer)

Backend (local dev):

```bash
cd Node_Backend
npm install
# create .env from .env.example and fill values
npm run dev
```

Mobile (local dev):

```bash
cd Smart_city_Mobile
npm install
npm start           # Metro bundler
npm run android     # or `npm run ios` on macOS with Xcode
```

Docker (recommended for full-stack local):

```bash
cd /Users/phyomyatmin/Desktop/smart_residential
docker compose up --build -d
docker compose logs -f
docker compose down
```

## Security & secrets

- Never commit `Node_Backend/.env` to source control. Add it to `.gitignore`.
- Rotate any credentials that were accidentally published.

## Where to look in the code

- Backend routes: `Node_Backend/src/routes/`
- Models: `Node_Backend/src/models/`
- MQTT service: `Node_Backend/src/services/mqtt.js`
- ESP32 QR scanner sketch: `Node_Backend/esp32_cam_qr_scanner.ino`
- Mobile app entry: `Smart_city_Mobile/App.jsx` and `Smart_city_Mobile/src/`

## Troubleshooting

- If Docker containers fail to start, check `docker compose logs -f` and the backend logs for environment/DB errors.
- If MQTT connection fails, confirm broker URL and credentials and network access.

## Contributing

See the CONTRIBUTING.md if present; otherwise use the standard fork → branch → PR workflow.

## License

Add your project license (e.g., MIT) here.

---

This README was expanded to include a focused project description, architecture notes, features, and safe environment guidance.
