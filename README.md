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
- AI assistant chatbox powered by local Ollama, RAG knowledge lookup, app tools, chat history, and feedback capture
- Safe AI improvement export pipeline for prompt/RAG/tool review and future LoRA/QLoRA fine-tuning datasets

Components

- Backend: Express + Mongoose (MongoDB). Authentication via JWT. Realtime via Socket.IO. MQTT client included for device messaging.
- Mobile: React Native app (Android/iOS) that hits backend REST APIs and subscribes to realtime notifications.
- Device: ESP32-CAM sketch (`Node_Backend/esp32_cam_qr_scanner.ino`) scans QR codes and communicates with the backend / MQTT broker.
- AI: Local Ollama model (for example `gemma4:12b`) is called through `Node_Backend/src/services/ai.service.js`. The assistant uses intent routing, RAG knowledge retrieval, safe tool calls, chat persistence, and user feedback.

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
- Resident AI assistant for bills, parking, visitors, helpers, maintenance, announcements, room data, policies, and general chat
- Personalized AI identity/profile answers loaded from the authenticated user's current database record
- User-isolated mobile chat sessions and backend history/data queries scoped by authenticated user ID
- AI feedback collection with thumbs up/down ratings on assistant answers
- AI training/review data export from `AiChat` + `AiFeedback` with PII redaction

## API endpoints (examples)

- `POST /api/auth/login` — authenticate user
- `POST /api/visitor` — register a visitor
- `GET /api/parking` — parking status
- `POST /api/sos` — send SOS alert
- `GET /api/notifications` — list notifications
- `POST /api/ai/chat` — ask the authenticated, user-aware AI assistant
- `GET /api/ai/history` — load authenticated user's AI chat history
- `POST /api/ai/feedback` — save thumbs up/down feedback for an assistant answer
- `GET /api/knowledge` / `POST /api/knowledge` — manage RAG knowledge base content

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
- `AI_ENABLE_TOOLS` — (optional) set `true` to pass tool schemas to Ollama for supported tool-capable models
- `AI_REQUIRE_AUTH` — (optional) set `true` in production to require JWT for `/api/ai/chat`
- `AI_RATE_LIMIT_ENABLED`, `AI_RATE_LIMIT_MAX`, `AI_RATE_LIMIT_WINDOW_MS` — (optional) AI chat rate-limit controls
- `AI_SYSTEM_PROMPT`, `AI_RESPONSE_STYLE_PROMPT` — (optional) system prompts for AI
- `RFID_DEVICE_SECRET` — (optional) require ESP32 RFID readers to send this value as `x-device-secret` or `deviceSecret`

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

## AI assistant improvement workflow

The mobile app includes a floating assistant chat. Authenticated users can ask questions, and assistant answers can be rated with thumbs up/down. Feedback is stored in MongoDB and can later be exported into safe JSONL files for review and future model improvement.

Key runtime flow:

1. User asks a question in `Smart_city_Mobile/src/components/FloatingChat.jsx`.
2. Mobile sends `POST /api/ai/chat`.
3. Backend classifies intent, retrieves RAG knowledge, runs safe app tools when needed, and calls Ollama.
4. Backend stores the user/assistant turn in `AiChat`.
5. User taps thumbs up/down.
6. Mobile sends `POST /api/ai/feedback`.
7. Backend stores the rating in `AiFeedback`.

Export feedback-backed datasets:

```bash
cd Node_Backend
npm run export:ai-dataset -- --limit 1000 --history-limit 8
```

Optional filters:

```bash
npm run export:ai-dataset -- --since 2026-06-01 --limit 5000
npm run export:ai-dataset -- --out ./exports/custom-ai-training
```

Export outputs are written under `Node_Backend/exports/ai-training/` by default:

- `ai-sft-*.jsonl` — positive-feedback conversations suitable for supervised fine-tuning review
- `ai-review-*.jsonl` — negative-feedback conversations for human rewrite, prompt fixes, RAG fixes, or tool-routing fixes
- `ai-summary-*.json` — aggregate quality signals by intent, tool usage, and RAG usage

The export script redacts sensitive values such as email addresses, phone numbers, resident/system IDs, UUIDs, Mongo ObjectIds, and tokens. Exported files are ignored by git through `Node_Backend/exports/`.

Important: Ollama does not automatically learn from the database. This workflow creates safe datasets that can be used to improve prompts, RAG knowledge, tool routing, and later LoRA/QLoRA fine-tuning workflows.

## Security & secrets

- Never commit `Node_Backend/.env` to source control. Add it to `.gitignore`.
- Rotate any credentials that were accidentally published.

## Where to look in the code

- Backend routes: `Node_Backend/src/routes/`
- Models: `Node_Backend/src/models/`
- AI assistant service: `Node_Backend/src/services/ai.service.js`
- AI intent routing: `Node_Backend/src/services/intent.service.js`
- AI RAG retrieval: `Node_Backend/src/services/rag.service.js`
- AI tool implementations: `Node_Backend/src/services/aiTools.service.js`
- AI feedback model: `Node_Backend/src/models/AiFeedback.js`
- AI dataset export: `Node_Backend/scripts/export-ai-finetune-dataset.js`
- MQTT service: `Node_Backend/src/services/mqtt.js`
- ESP32 QR scanner sketch: `Node_Backend/esp32_cam_qr_scanner.ino`
- Mobile app entry: `Smart_city_Mobile/App.jsx` and `Smart_city_Mobile/src/`
- Mobile AI chat UI: `Smart_city_Mobile/src/components/FloatingChat.jsx`

## Troubleshooting

- If Docker containers fail to start, check `docker compose logs -f` and the backend logs for environment/DB errors.
- If MQTT connection fails, confirm broker URL and credentials and network access.
- If AI replies fail, confirm Ollama is running, `OLLAMA_BASE_URL` is reachable, and `OLLAMA_MODEL` is installed locally.
- If `npm run export:ai-dataset` returns `0 SFT, 0 review`, collect thumbs up/down feedback in the mobile chat first.

## Contributing

See the CONTRIBUTING.md if present; otherwise use the standard fork → branch → PR workflow.

## License

Add your project license (e.g., MIT) here.

---

This README was expanded to include a focused project description, architecture notes, features, and safe environment guidance.
