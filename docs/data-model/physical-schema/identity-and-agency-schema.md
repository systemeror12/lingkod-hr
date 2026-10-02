# Identity and Agency Physical Schema

**Document status:** Draft for review  
**Model level:** Physical PostgreSQL design  
**Primary profile:** Civilian Philippine National Government Agency  
**Database:** PostgreSQL  
**ORM target:** Prisma with reviewed SQL migrations where required  
**Version:** 1.0  
**Date:** August 6, 2026

---


## 1. Tables

### `agencies`

```sql
CREATE TABLE agencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL,
  name text NOT NULL,
  acronym text,
  agency_type text NOT NULL
    CHECK (agency_type IN ('NGA','LGU','SUC','GOCC_ORIGINAL_CHARTER','OTHER')),
  status text NOT NULL
    CHECK (status IN ('DRAFT','ACTIVE','SUSPENDED','ARCHIVED')),
  default_timezone text NOT NULL DEFAULT 'Asia/Manila',
  default_currency char(3) NOT NULL DEFAULT 'PHP',
  current_profile_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code),
  UNIQUE (id, code)
);
```

### `agency_profile_versions`

```sql
CREATE TABLE agency_profile_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no > 0),
  appointing_authority_title text,
  deployment_profile text NOT NULL
    CHECK (deployment_profile IN ('SHARED_SAAS','DEDICATED_CLOUD','AGENCY_HOSTED')),
  effective_from date NOT NULL,
  effective_to date,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL
    CHECK (status IN ('DRAFT','ACTIVE','SUPERSEDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (agency_id, version_no),
  UNIQUE (agency_id, id)
);
```

Add the current-profile foreign key only after both tables exist.

### `users`

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_provider text,         -- null for a LingkodHR-owned User
  external_subject text,
  email_normalized citext NOT NULL,
  display_name text NOT NULL,
  global_status text NOT NULL
    CHECK (global_status IN ('ACTIVE','LOCKED','DEACTIVATED')),
  email_verified_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (identity_provider, external_subject),
  UNIQUE (email_normalized)
);
```

### `agency_memberships`

```sql
CREATE TABLE agency_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  employee_id uuid,
  primary_organization_unit_id uuid,
  status text NOT NULL
    CHECK (status IN ('INVITED','ACTIVE','LOCKED','SUSPENDED','DEACTIVATED')),
  activated_at timestamptz,
  deactivated_at timestamptz,
  deactivation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX agency_memberships_active_user_uq
ON agency_memberships (agency_id, user_id)
WHERE status IN ('INVITED','ACTIVE','LOCKED','SUSPENDED');
```

Employee and organization-unit foreign keys are added in later migrations after those tables exist.

### `invitations`

System-issued invitations may have no inviter membership; later Agency-scoped
invitations must still supply the initiating membership.

```sql
CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  email_normalized citext NOT NULL,
  invited_by_membership_id uuid,
  token_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  status text NOT NULL
    CHECK (status IN ('PENDING','ACCEPTED','EXPIRED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, invited_by_membership_id)
    REFERENCES agency_memberships (agency_id, id)
    ON DELETE RESTRICT,
  UNIQUE (token_hash),
  CHECK (expires_at > created_at)
);
```

### Roles and permissions

```sql
CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid REFERENCES agencies(id) ON DELETE RESTRICT,
  code citext NOT NULL,
  name text NOT NULL,
  is_system_template boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX roles_agency_code_uq
ON roles (agency_id, code)
WHERE agency_id IS NOT NULL;

CREATE UNIQUE INDEX roles_global_code_uq
ON roles (code)
WHERE agency_id IS NULL;

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL UNIQUE,
  domain text NOT NULL,
  risk_level text NOT NULL
    CHECK (risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  description text NOT NULL
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
  scope_policy text NOT NULL
    CHECK (scope_policy IN ('OWN','DIRECT_REPORTS','ASSIGNED_OFFICE','AGENCY','RESTRICTED')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by_membership_id uuid,
  PRIMARY KEY (role_id, permission_id, scope_policy)
);
```

### `membership_roles`

The first system-issued Agency Administrator role assignment may have no
assigning membership; later role assignments must still identify the actor.

```sql
CREATE TABLE membership_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  assigned_by_membership_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  FOREIGN KEY (agency_id, membership_id)
    REFERENCES agency_memberships (agency_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (agency_id, assigned_by_membership_id)
    REFERENCES agency_memberships (agency_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX membership_roles_active_idx
ON membership_roles (agency_id, membership_id, role_id)
WHERE effective_to IS NULL;
```

### `delegated_authorities`

```sql
CREATE TABLE delegated_authorities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  delegator_membership_id uuid NOT NULL,
  delegate_membership_id uuid NOT NULL,
  permission_code citext NOT NULL REFERENCES permissions(code) ON DELETE RESTRICT,
  organization_unit_id uuid,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','REVOKED','EXPIRED')),
  authority_document_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to > effective_from),
  CHECK (delegator_membership_id <> delegate_membership_id),
  FOREIGN KEY (agency_id, delegator_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, delegate_membership_id)
    REFERENCES agency_memberships (agency_id, id)
);
```

### Sessions and security events

```sql
CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  agency_membership_id uuid REFERENCES agency_memberships(id) ON DELETE SET NULL,
  session_token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revocation_reason text,
  CHECK (expires_at > created_at)
);

CREATE TABLE security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid REFERENCES agencies(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  membership_id uuid REFERENCES agency_memberships(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  request_id text,
  ip_address inet,
  email_hash bytea,               -- HMAC-SHA-256 with BLIND_INDEX_KEY; never the raw email
  user_agent text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
```

### Owned sign-in credentials

These rows belong to the User, not to an Agency, so they carry no `agency_id`.

```sql
CREATE TABLE user_passwords (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,    -- Argon2id PHC string
  changed_at timestamptz NOT NULL DEFAULT now(),
  second_factor_failures integer NOT NULL DEFAULT 0 CHECK (second_factor_failures >= 0),
  reset_required_at timestamptz
);

CREATE TABLE user_totp_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  secret_envelope bytea NOT NULL, -- PV1 envelope bound to user_id and id
  last_accepted_step bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pending_authentications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash bytea NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('SIGN_IN','ACTIVATION')),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  invitation_id uuid REFERENCES invitations(id) ON DELETE CASCADE,
  requested_membership_id uuid,
  stage text NOT NULL,
  verified_methods text[] NOT NULL DEFAULT ARRAY[]::text[],
  display_name text,
  password_hash text,
  enrollment_secret_envelope bytea,
  recovery_code_hashes text[] NOT NULL DEFAULT ARRAY[]::text[],
  enrollment_accepted_step bigint,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (
    (purpose = 'SIGN_IN' AND user_id IS NOT NULL AND invitation_id IS NULL)
    OR (purpose = 'ACTIVATION' AND invitation_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX pending_authentications_sign_in_user_uq
  ON pending_authentications (user_id) WHERE purpose = 'SIGN_IN';
CREATE UNIQUE INDEX pending_authentications_activation_invitation_uq
  ON pending_authentications (invitation_id) WHERE purpose = 'ACTIVATION';
```

The runtime role may update only `last_accepted_step` on `user_totp_factors` and
may not update `user_recovery_codes`; both are replaced by deleting rows.

---

## 2. RLS

Enable RLS on all agency-owned tables:

```sql
ALTER TABLE agency_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_profile_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegated_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
```

Baseline policy:

```sql
CREATE POLICY agency_memberships_isolation
ON agency_memberships
USING (agency_id = current_setting('app.agency_id', true)::uuid)
WITH CHECK (agency_id = current_setting('app.agency_id', true)::uuid);
```

`users` is global and should be accessed only through identity services, not ordinary tenant repositories.

The owned sign-in tables follow the `user_sessions` pattern: RLS is enabled and
forced, and rows are visible only in the owning User's context. Pending state is
also visible through the hash of its cookie token, before a session exists:

```sql
CREATE POLICY user_passwords_owner ON user_passwords
USING (user_id = app_user_id())
WITH CHECK (user_id = app_user_id());
-- Same owner policy on user_totp_factors and user_recovery_codes.

CREATE POLICY pending_authentications_owner ON pending_authentications
USING (
  user_id = app_user_id()
  OR encode(token_hash, 'hex') = current_setting('app.pending_token_hash', true)
)
WITH CHECK (
  user_id = app_user_id()
  OR encode(token_hash, 'hex') = current_setting('app.pending_token_hash', true)
);
```

---

## 3. Indexes

```sql
CREATE INDEX agency_memberships_user_idx
  ON agency_memberships (user_id);

CREATE INDEX membership_roles_membership_active_idx
  ON membership_roles (agency_id, membership_id, effective_from, effective_to);

CREATE INDEX delegated_authorities_delegate_active_idx
  ON delegated_authorities (agency_id, delegate_membership_id, effective_from, effective_to)
  WHERE status = 'ACTIVE';

CREATE INDEX security_events_agency_time_idx
  ON security_events (agency_id, occurred_at DESC);

CREATE INDEX security_events_email_type_time_idx
  ON security_events (email_hash, event_type, occurred_at);

CREATE INDEX security_events_ip_type_time_idx
  ON security_events (ip_address, event_type, occurred_at);

CREATE INDEX user_recovery_codes_user_idx
  ON user_recovery_codes (user_id);
```

---

## 4. Deletion Rules

- Agencies: archive only.
- Users: deactivate only after use.
- Memberships: deactivate.
- Roles: inactivate after assignment history exists.
- Permissions: never delete after release.
- Invitations and sessions: purge after retention.
- Passwords, TOTP factors, Recovery Codes, and pending authentications: delete on replacement or use; cascade with the User.
- Security events: append-only and retention-controlled.
