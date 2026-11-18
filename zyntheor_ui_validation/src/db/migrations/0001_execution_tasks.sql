CREATE TABLE IF NOT EXISTS execution_tasks (
  task_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  owner_user_id text NOT NULL,
  lifecycle_status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  task jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS execution_tasks_tenant_owner_created_idx
  ON execution_tasks (tenant_id, owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS execution_tasks_tenant_status_idx
  ON execution_tasks (tenant_id, lifecycle_status);
