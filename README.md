# lingkod-hr
AI-enabled Philippine Public-Sector HRIS for end-to-end workforce management—from plantilla and recruitment to attendance, leave, payroll, SPMS, separation, approvals, documents, and audit trails.

## Local development

Requirements: Node.js 24, pnpm 11.17.0, and Docker Compose.

```bash
pnpm install
cp .env.example .env
docker compose -f infrastructure/compose.yaml up -d
pnpm db:migrate
pnpm dev
```

The web app listens on `http://localhost:3000`, the API health endpoint is
`http://localhost:3001/api/v1/health`, and the worker health endpoint is
`http://localhost:3002/health`.

Run repository validation with:

```bash
pnpm validate
```
