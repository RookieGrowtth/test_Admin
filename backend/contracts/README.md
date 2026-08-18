# Backend boundaries

- `storage/`: persistence adapter. Routes and feature services never open SQLite directly.
- `contracts/`: stable external REST contract. `openapi.yaml` is the source for CI/Runner integrations.
- `services/`: feature services are the next extraction point. Existing MVP routes remain compatible while endpoints under `/api/v1` provide a stable integration surface.

The active runtime still uses `server.js` as a composition root. This is intentional for a dependency-free MVP; the new folders isolate contracts and storage so future migration to Fastify/Nest/FastAPI or normalized SQLite/PostgreSQL repositories does not require clients to change URLs.
