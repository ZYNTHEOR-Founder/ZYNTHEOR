# ZYNTHEOR Q+ Cloud-Native Deployment Architecture Guide

## 1. Architecture Overview
- **Frontend (React + Vite)**: Resolves all backend calls through `import.meta.env.VITE_API_URL` (`src/lib/apiClient.ts`) with zero hardcoded `localhost` origins.
- **API & Python Native Bridge (`server.ts` + `qplus_native/`)**: Single container or decoupled service exposing REST + NDJSON streaming endpoints with CORS (`ALLOWED_ORIGINS`) and Firebase ID Token + Sovereign HMAC verification.
- **Cloud Database (PostgreSQL + Drizzle ORM)**:
  - `src/db/schema.ts`: `users`, `audit_ledger`, `quick_log_seals`, `memory_store`, `knowledge_documents`, `knowledge_chunks`, `curated_datasets`, `model_checkpoints`.
  - `src/db/index.ts`: Uses `pg.Pool` Object Method (`SQL_HOST`, `SQL_USER`, `SQL_PASSWORD`, `SQL_DB_NAME`).
- **Cloud Object Storage for `.pt` Checkpoints**:
  - Node.js (`lib/CloudCheckpointStorage.ts`) streams & verifies `.pt` weights via `@aws-sdk/client-s3`.
  - Python bridge (`qplus_native/cloud_storage.py`) streams `.pt` weights via `boto3` or `CHECKPOINT_PRESIGNED_URL`.

---

## 2. Required Environment Variables

### Backend (Cloud Run / Render / Railway)
- `PORT=8080`
- `NODE_ENV=production`
- `ZYNTHEOR_MASTER_SECRET=<32+ char high-entropy secret>`
- `ALLOWED_ORIGINS=https://your-frontend.example.com`
- `SQL_HOST=<Cloud SQL Unix socket / Postgres host>`
- `SQL_DB_NAME=<Postgres database name>`
- `SQL_USER=<Postgres app user>`
- `SQL_PASSWORD=<Postgres app password>`
- `SQL_ADMIN_USER=<Postgres migration admin user>`
- `SQL_ADMIN_PASSWORD=<Postgres migration admin password>`
- `CHECKPOINT_STORAGE_PROVIDER=s3`
- `S3_BUCKET=<bucket name>`
- `S3_REGION=<region or auto>`
- `S3_ENDPOINT=<R2 / Supabase S3 / GCS S3-interop endpoint (optional for AWS S3)>`
- `S3_FORCE_PATH_STYLE=true` (required for MinIO / Supabase S3)
- `S3_ACCESS_KEY_ID=<access key>`
- `S3_SECRET_ACCESS_KEY=<secret key>`
- `S3_CHECKPOINT_KEY=checkpoints/model_checkpoint.pt`

### Frontend (Vite Build-Time Variable)
- `VITE_API_URL=https://api.your-zyntheor-domain.com`

---

## 3. Deploying to Google Cloud Run (Recommended)
1. Build and push image to Artifact Registry:
   ```bash
   gcloud builds submit --tag asia-southeast1-docker.pkg.dev/$PROJECT_ID/zyntheor/runtime:latest
   ```
2. Deploy with Cloud SQL connection & env vars:
   ```bash
   gcloud run deploy zyntheor-runtime \
     --image asia-southeast1-docker.pkg.dev/$PROJECT_ID/zyntheor/runtime:latest \
     --region asia-southeast1 \
     --port 8080 \
     --add-cloudsql-instances $PROJECT_ID:asia-southeast1:ai-studio-ec0b64ae \
     --set-env-vars "NODE_ENV=production,SQL_HOST=/cloudsql/$PROJECT_ID:asia-southeast1:ai-studio-ec0b64ae,SQL_DB_NAME=postgres,CHECKPOINT_STORAGE_PROVIDER=s3,S3_BUCKET=zyntheor-checkpoints"
   ```
3. Push schema migrations via Drizzle Kit:
   ```bash
   npx drizzle-kit push --config=src/db/drizzle.config.ts
   ```

## 4. Deploying to Render or Railway
1. Connect repository and select **Docker** runtime (`Dockerfile` at repo root).
2. Provision a managed **PostgreSQL** service and map `SQL_HOST`, `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD`, `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD`.
3. Create an **S3 / Cloudflare R2 / Supabase Storage** bucket, upload your `.pt` checkpoints to `checkpoints/model_checkpoint.pt`, and set `S3_*` variables.
4. Set `VITE_API_URL` on your static frontend host (or leave empty if served from the same `zyntheor-runtime` container).
