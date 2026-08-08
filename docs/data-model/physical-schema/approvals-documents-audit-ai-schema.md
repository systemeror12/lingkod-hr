# Approvals, Documents, Audit, Notifications, and AI Physical Schema

**Document status:** Draft for review  
**Model level:** Physical PostgreSQL design  
**Primary profile:** Civilian Philippine National Government Agency  
**Database:** PostgreSQL  
**ORM target:** Prisma with reviewed SQL migrations where required  
**Version:** 1.0  
**Date:** August 6, 2026

---


## 1. Approval Routes

```sql
CREATE TABLE approval_route_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  route_code citext NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  domain text NOT NULL,
  step_definition jsonb NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL CHECK (status IN ('DRAFT','ACTIVE','SUPERSEDED')),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (agency_id, route_code, version_no),
  UNIQUE (agency_id, id)
);
```

Route JSON is validated by application schema before activation.

---

## 2. Approval Requests and Steps

```sql
CREATE TABLE approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  route_version_id uuid NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  requested_by_membership_id uuid NOT NULL,
  status text NOT NULL
    CHECK (status IN ('PENDING','IN_PROGRESS','APPROVED','REJECTED','RETURNED','CANCELLED','EXPIRED')),
  current_step_no integer,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (agency_id, route_version_id)
    REFERENCES approval_route_versions (agency_id, id),
  FOREIGN KEY (agency_id, requested_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);
```

```sql
CREATE TABLE approval_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  approval_request_id uuid NOT NULL,
  step_no integer NOT NULL CHECK (step_no > 0),
  step_mode text NOT NULL
    CHECK (step_mode IN ('SEQUENTIAL','PARALLEL_ANY','PARALLEL_ALL')),
  required_permission citext NOT NULL REFERENCES permissions(code),
  assigned_membership_id uuid,
  assigned_role_code citext,
  status text NOT NULL
    CHECK (status IN ('PENDING','ACTIVE','APPROVED','REJECTED','RETURNED','SKIPPED','EXPIRED')),
  activated_at timestamptz,
  completed_at timestamptz,
  FOREIGN KEY (agency_id, approval_request_id)
    REFERENCES approval_requests (agency_id, id),
  FOREIGN KEY (agency_id, assigned_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (approval_request_id, step_no, assigned_membership_id),
  UNIQUE (agency_id, id)
);
```

### Decisions

```sql
CREATE TABLE approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  approval_step_id uuid NOT NULL,
  decided_by_membership_id uuid NOT NULL,
  decision text NOT NULL
    CHECK (decision IN ('APPROVE','REJECT','RETURN','ABSTAIN','DELEGATE')),
  comments text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  delegated_authority_id uuid,
  request_id text,
  FOREIGN KEY (agency_id, approval_step_id)
    REFERENCES approval_steps (agency_id, id),
  FOREIGN KEY (agency_id, decided_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, delegated_authority_id)
    REFERENCES delegated_authorities (agency_id, id),
  UNIQUE (agency_id, id)
);
```

Approval decisions are immutable.

The generic approval service must call the owning domain service after completion.

---

## 3. Documents

```sql
CREATE TABLE retention_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  code citext NOT NULL,
  name text NOT NULL,
  retention_years integer CHECK (retention_years IS NULL OR retention_years >= 0),
  disposition_action text NOT NULL
    CHECK (disposition_action IN ('DESTROY','ARCHIVE','REVIEW','PERMANENT')),
  legal_basis text,
  status text NOT NULL CHECK (status IN ('ACTIVE','INACTIVE')),
  UNIQUE (agency_id, code),
  UNIQUE (agency_id, id)
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  document_no citext,
  document_type text NOT NULL,
  classification text NOT NULL
    CHECK (classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','HIGHLY_SENSITIVE')),
  status text NOT NULL
    CHECK (status IN ('DRAFT','FOR_REVIEW','APPROVED','ISSUED','ARCHIVED','SUPERSEDED','VOIDED')),
  current_version_id uuid,
  retention_class_id uuid,
  FOREIGN KEY (agency_id, retention_class_id)
    REFERENCES retention_classes (agency_id, id),
  UNIQUE (agency_id, document_no),
  UNIQUE (agency_id, id)
);
```

```sql
CREATE TABLE document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  storage_key text NOT NULL UNIQUE,
  content_hash text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  issued_at timestamptz,
  signature_metadata jsonb,
  FOREIGN KEY (agency_id, document_id)
    REFERENCES documents (agency_id, id),
  FOREIGN KEY (agency_id, created_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (document_id, version_no),
  UNIQUE (agency_id, id)
);
```

Issued versions are immutable.

```sql
CREATE TABLE document_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  link_role text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  linked_by_membership_id uuid NOT NULL,
  FOREIGN KEY (agency_id, document_id)
    REFERENCES documents (agency_id, id),
  FOREIGN KEY (agency_id, linked_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (document_id, subject_type, subject_id, link_role)
);
```

---

## 4. Audit

```sql
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  actor_membership_id uuid,
  actor_type text NOT NULL
    CHECK (actor_type IN ('USER','SYSTEM','INTEGRATION')),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  previous_status text,
  new_status text,
  reason text,
  request_id text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (agency_id, actor_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE audit_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  audit_event_id uuid NOT NULL,
  field_path text NOT NULL,
  old_value_redacted jsonb,
  new_value_redacted jsonb,
  sensitivity text NOT NULL
    CHECK (sensitivity IN ('NORMAL','SENSITIVE','HIGHLY_SENSITIVE')),
  FOREIGN KEY (agency_id, audit_event_id)
    REFERENCES audit_events (agency_id, id)
);
```

Attach immutable triggers.

Potential future partitioning:

```text
audit_events by occurred_at month or quarter
```

---

## 5. Notifications

```sql
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  recipient_membership_id uuid NOT NULL,
  notification_type text NOT NULL,
  title text NOT NULL,
  body_safe text NOT NULL,
  subject_type text,
  subject_id uuid,
  status text NOT NULL
    CHECK (status IN ('PENDING','SENT','READ','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  FOREIGN KEY (agency_id, recipient_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  notification_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('EMAIL','IN_APP')),
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  status text NOT NULL
    CHECK (status IN ('QUEUED','SENT','DELIVERED','FAILED','PERMANENT_FAILURE')),
  provider_message_id text,
  attempted_at timestamptz,
  error_code text,
  FOREIGN KEY (agency_id, notification_id)
    REFERENCES notifications (agency_id, id),
  UNIQUE (notification_id, channel, attempt_no)
);
```

---

## 6. Transactional Outbox

```sql
CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text
);

CREATE INDEX outbox_events_pending_idx
ON outbox_events (available_at, created_at)
WHERE processed_at IS NULL;
```

Use the outbox for notifications, PDF generation, integrations, and AI jobs.

---

## 7. AI Requests

```sql
CREATE TABLE ai_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  initiated_by_membership_id uuid NOT NULL,
  feature_code text NOT NULL,
  model_provider text NOT NULL,
  model_name text NOT NULL,
  prompt_version text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('CREATED','PROCESSING','VALIDATED','NEEDS_REVIEW','ACCEPTED','REJECTED','FAILED','CANCELLED')),
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (agency_id, initiated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);
```

```sql
CREATE TABLE ai_input_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  ai_request_id uuid NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  field_scope jsonb NOT NULL,
  redaction_profile text,
  FOREIGN KEY (agency_id, ai_request_id)
    REFERENCES ai_requests (agency_id, id)
);

CREATE TABLE ai_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  ai_request_id uuid NOT NULL,
  output_type text NOT NULL
    CHECK (output_type IN ('STRUCTURED','TEXT_DRAFT','SUMMARY')),
  structured_output jsonb,
  text_output text,
  validation_status text NOT NULL
    CHECK (validation_status IN ('VALID','INVALID','PARTIAL')),
  validation_errors jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, ai_request_id)
    REFERENCES ai_requests (agency_id, id)
);
```

Human review:

```sql
CREATE TABLE ai_review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  ai_output_id uuid NOT NULL,
  reviewed_by_membership_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('ACCEPT','EDIT','REJECT')),
  edited_output jsonb,
  reason text,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, reviewed_by_membership_id)
    REFERENCES agency_memberships (agency_id, id)
);
```

AI acceptance never performs domain approval by itself.

---

## 8. RLS and Classification

All shared agency-owned tables use RLS.

Document access requires both:

- agency match;
- permission based on classification and subject link.

Highly sensitive documents should use short-lived signed download URLs generated only after authorization.
