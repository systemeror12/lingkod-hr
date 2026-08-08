# Platform options within the approved HRIS architecture

**Research date:** 2026-08-09 (Asia/Manila)

**Wayfinder question:** Which currently supported managed OIDC providers, local S3-compatible object-storage services, and production deployment arrangements fit the approved architecture, security baseline, solo-developer constraint, and portability goals?

## Scope and method

This note compares representative, currently supported options against the project's existing decisions. It does not select a provider or change the architecture.

The project baseline is:

- a TypeScript modular monolith with separate Next.js web, NestJS API, and BullMQ worker processes;
- PostgreSQL with `pgvector`, Redis-compatible queue/cache, and S3-compatible private object storage;
- managed OIDC authentication, with application-owned Agency memberships, permissions, and authorization;
- provider-side MFA capability plus application/session revocation, login auditing, abuse controls, and separate identity applications per environment;
- Docker Compose for local infrastructure and managed production infrastructure without Kubernetes; and
- a solo-developer operating model that values predictable cost and provider-neutral application contracts.

Those constraints come from `docs/technical-architecture.md`, `docs/tech-stack-prerequisites.md`, `docs/hris-controls.md`, and `docs/erp-ai-coding-practices.md`. Product facts below come only from current first-party vendor documentation. Prices are public list prices observed on the research date; they are not quotes and exclude tax, support, messaging, transfer, and negotiated terms unless stated otherwise.

## Findings at a glance

1. **All three OIDC candidates can satisfy basic OIDC and MFA integration, but their revocation, audit, environment-isolation, data-region, and exit paths differ materially.** OIDC makes the application integration portable; it does not make hosted credentials, MFA enrollments, logs, or plan-gated controls portable.
2. **The historical local default, MinIO Community Server, is no longer a sound new-project default.** Its official repository was archived on 25 April 2026 and legacy binaries no longer receive updates. Active alternatives exist, but each needs an application-level S3 contract test.
3. **The approved three-process monolith fits a cohesive PaaS or managed containers.** Render and DigitalOcean reduce day-two work; AWS ECS/Fargate exposes more infrastructure and cost dimensions but can keep the whole production stack in one mature cloud and one nearby region.
4. **A production deployment choice cannot be responsible without an availability target, recovery target, accepted data locations, and monthly budget ceiling.** “Managed” alone does not imply high availability, long backup retention, or tested restore.

## Managed OIDC providers

The application should use Authorization Code flow, validate issuer/audience/signature/expiry, map the stable external `sub` to its own user record, and keep Agency membership and authorization out of provider-specific claims. Local application sessions and a revocation check remain necessary regardless of provider.

| Candidate | Fit with the baseline | Security/session constraints | Cost and locality | Portability/exit constraints |
|---|---|---|---|---|
| **Auth0** | Standards-based hosted login and broad MFA factors (security keys, OTP, push, phone, Duo, biometrics, email recovery) reduce implementation work. Separate tenants are the documented environment model. | Refresh tokens can be revoked, but OIDC back-channel logout is Enterprise-only. Lower plans therefore still require the HRIS to revoke its own durable sessions and use short token lifetimes; provider logout alone is not equivalent to application-session revocation. | The public pricing page observed on the research date shows a free tier and an Essentials tier starting at US$35/month for 500 MAU in its displayed B2C schedule; Essentials explicitly includes Pro MFA and separate production/development environments. The applicable B2B/internal-workforce schedule must be checked before selection. Public-cloud data localities include Australia and Japan, but not the Philippines. | Bulk profile export is available, but password hashes and MFA secrets require an eligible support request, PGP encryption, additional authorization, and potentially an executive signature. That is real exit friction even though the RP integration is standard OIDC. |
| **Amazon Cognito User Pools** | Cognito user pools expose OIDC discovery, authorization, token, user-info, and revocation endpoints. TOTP/SMS MFA is available in all tiers; Essentials adds managed login, passkeys/passwordless options, refresh-token rotation, and password-history controls. It integrates naturally if production is also on AWS. | `AdminUserGlobalSignOut` can invalidate all Cognito tokens for a user. However, AWS explicitly warns that a revoked self-contained JWT still passes ordinary signature/expiry verification; the API must therefore combine short-lived access tokens with its own session/revocation policy instead of treating offline JWT verification as immediate revocation. | Lite and Essentials include 10,000 direct/social MAU per account or AWS Organization; Essentials is US$0.015 per direct MAU above that tier. SMS/email and some advanced protections are separately billed. Cognito is available in AWS regions including Asia Pacific (Singapore), which can align identity and application locality if AWS is selected. | AWS's official export guidance copies profiles/groups but not passwords or TOTP MFA material and assigns new `sub` values in a replacement pool. Cognito added import of supported password hashes in July 2026, but that improves migration *into* Cognito; it does not remove the documented export limitation. |
| **ZITADEL Cloud** | ZITADEL publishes standard OIDC discovery/token/revocation/end-session endpoints, MFA/passkeys, an audit event model, and OIDC back-channel logout. Cloud and self-hosted editions use the same product, which creates a credible future hosting path without making self-hosting part of this MVP. | Back-channel logout can notify the HRIS to terminate its local session, but the application must expose a TLS endpoint, validate logout tokens, and durably index local sessions by `sid`. Provider-side session deletion still does not replace the HRIS's own account-state checks. | Free currently includes all security features for 100 daily active users. Pro starts at US$100/month and includes 25,000 DAU, a custom domain, and a 99.5% uptime guarantee. Pricing is DAU- rather than MAU-based. Managed data regions listed by ZITADEL include Australia, Europe, Switzerland, and the US; Australia is the closest listed option to the Philippines. | ZITADEL documents cloud-to-self-hosted export/import including password hashes and OTP secrets, but current migration omits global policies, global MFA configuration, passkeys, application keys, and the event-stream audit trail. It is more operationally portable than a cloud-only service, but migration is not lossless. |

Primary sources:

- Auth0: [MFA factors and policy](https://auth0.com/docs/secure/multi-factor-authentication/enable-mfa), [refresh-token revocation](https://auth0.com/docs/api/authentication/revoke-refresh-token/revoke-refresh-token), [Enterprise-only back-channel logout](https://auth0.com/docs/authenticate/login/logout/back-channel-logout), [tenant regions](https://auth0.com/docs/get-started/auth0-overview/create-tenants), [pricing](https://auth0.com/pricing), and [password/MFA export process](https://auth0.com/docs/manage-users/user-migration/export-password-hashes-and-mfa-secrets).
- Cognito: [OIDC issuer endpoints](https://docs.aws.amazon.com/cognito/latest/developerguide/federation-endpoints.html), [authentication and MFA](https://docs.aws.amazon.com/cognito/latest/developerguide/what-is-amazon-cognito.html), [token revocation caveat](https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html), [tiers and pricing](https://aws.amazon.com/cognito/pricing/), [profile export limitations](https://docs.aws.amazon.com/solutions/latest/cognito-user-profiles-export-reference-architecture/guidance-components.html), and [password-hash import announcement](https://aws.amazon.com/about-aws/whats-new/2026/07/amazon-cognito-password-hash-import/).
- ZITADEL: [OIDC endpoints](https://zitadel.com/docs/apis/openidoauth/endpoints), [back-channel logout](https://zitadel.com/docs/guides/integrate/back-channel-logout), [features](https://zitadel.com/docs), [pricing](https://zitadel.com/pricing), [Cloud regions](https://zitadel.com/docs/guides/manage/cloud/egress), and [export/import limitations](https://zitadel.com/docs/guides/migrate/sources/zitadel).

### OIDC decision constraints exposed

The provider decision should explicitly choose:

- acceptable identity-data regions and the required vendor/privacy review;
- mandatory factors (TOTP, WebAuthn/passkeys, recovery methods) and whether adaptive/compromised-credential protection is required;
- the exact revocation contract: maximum access-token age, application-session lookup, administrative global logout, and optional back-channel logout;
- dev/staging/production isolation and whether plan limits make three environments materially more expensive;
- expected active-user count and whether MAU or DAU billing is more predictable; and
- acceptable credential and MFA migration loss if the provider changes.

## Local S3-compatible object storage

The local service is a development dependency, not the production record store. It should be pinned to a version, bind only to the local/container network, require credentials, persist to a named volume, and be replaceable by changing `S3_ENDPOINT`, credentials, region, and bucket. The application should use the AWS S3 SDK rather than a vendor SDK.

| Candidate | Local-development strengths | Material constraints |
|---|---|---|
| **SeaweedFS (`weed mini`)** | Active Apache-2.0 project; an official single-container quick start starts an authenticated S3 endpoint and pre-creates a bucket. The same binary can scale into filer/volume/S3 components, but local use can remain one service. Current releases and active S3 work make it the most mature active permissively licensed candidate in this comparison. | Omitting access-key environment variables starts the quick-start endpoint in unauthenticated “Allow All” mode. SeaweedFS implements more than an object store, so its local surface is broader than the HRIS needs. S3 compatibility has evolved rapidly; presigned virtual-host/path-style behavior and any versioning/object-lock assumptions must be tested rather than inferred. |
| **Garage** | Active, lightweight S3-compatible service designed for small self-hosted deployments; official images and a one-node Docker quick start are available. Its narrow object-storage focus and small image suit a local Compose service. | AGPLv3 rather than a permissive license. Initial node layout, API key, bucket, and permissions require explicit setup. Garage's own quick start states that ACL and policy features are not implemented, and a single-node deployment has no redundancy. Those are acceptable only if the local contract relies on private credentials and application authorization, not S3 ACL semantics. |
| **RustFS (watchlist)** | Apache-2.0, official Docker image, console, and documented compatibility with the AWS S3 SDK. The local single-node/single-disk mode is intentionally aimed at testing and small scenarios. | The vendor download page currently labels its latest release `v1.0.0-beta.11-preview.1`. Despite broad “100% compatible” claims, this maturity label makes it a higher-risk foundation until the exact HRIS operations pass tests and a stable support policy is established. |

**Not shortlisted as a new default:** the official `minio/minio` repository was [archived on 25 April 2026](https://github.com/minio/minio). Its README says Community Edition is source-only and historical binaries will not receive updates. Existing documentation can still help define an S3 contract, but a new project should not pin an archived server as its maintained local security dependency.

Primary sources:

- SeaweedFS: [official repository, license, and Docker S3 quick start](https://github.com/seaweedfs/seaweedfs) and [current releases](https://github.com/seaweedfs/seaweedfs/releases).
- Garage: [official project mirror and license](https://github.com/deuxfleurs-org/garage), [quick start and compatibility warning](https://garagehq.deuxfleurs.fr/documentation/), and [official Docker image](https://hub.docker.com/r/dxflrs/garage).
- RustFS: [Docker installation](https://docs.rustfs.com/installation/docker/), [SDK guidance](https://docs.rustfs.com/developer/sdk/), and [current release label](https://rustfs.com/download/?platform=docker).

### Required S3 contract test before selecting the local service

Run the same integration suite against the local candidate and the intended production store:

- private `PutObject`, `GetObject`, `HeadObject`, `DeleteObject`, and paginated list;
- opaque keys and custom metadata without PII in key names;
- AWS Signature V4 presigned GET and PUT, including expiry and rejected tampering;
- multipart upload, abort, checksum/ETag handling, size limits, and incomplete-upload cleanup;
- content-type and size validation followed by server-side verification;
- denied anonymous/public access and least-privilege credentials; and
- retry/idempotency behavior for interrupted uploads.

Bucket versioning, lifecycle, legal hold, and object lock should be added only if a later records-policy decision makes them part of the production contract. Application-level document versions and retention metadata cannot be delegated blindly to a partially compatible S3 implementation.

## Production deployment arrangements

The arrangements below preserve separate web, API, and continuously running worker processes. None requires Kubernetes.

| Arrangement | Architecture fit | Solo-developer/operations | Cost shape | Portability and material constraints |
|---|---|---|---|---|
| **Render PaaS in Singapore + external managed S3 storage** | Deploy web and API as web/private services and BullMQ as a background worker; use Render Postgres (`pgvector` supported) and paid Key Value with `noeviction` plus journal/snapshot persistence. Same-region services and datastores use Render's private network. | Smallest control surface in this comparison. Docker and `render.yaml` Blueprints support reproducible service definitions, zero-downtime deploys, pre-deploy migrations, and rollback-oriented deploy history. Render explicitly documents BullMQ workers. | Five always-on paid resources (web, API, worker, PostgreSQL, Key Value), workspace charges/features, pipeline use, transfer, and an external object store. Current service floors start at 512 MB; production database HA requires eligible higher database types. Use Render's live calculator because its workspace plans changed in April 2026 and the pricing page is dynamic. | Application containers, PostgreSQL, Redis protocol, OIDC, and S3 remain portable, while Blueprint/network/secret configuration is Render-specific. Render does not provide the required managed S3 store, so files cross a vendor boundary. Existing services/databases cannot change region in place; migration is required. Background workers can initiate private-network connections but cannot receive them, which is compatible with polling BullMQ. |
| **DigitalOcean App Platform + Managed PostgreSQL + Managed Valkey + Spaces in Singapore** | App Platform supports service and worker components from Git or container images. Singapore App Platform can connect to SGP1 VPC resources; Managed PostgreSQL supports `pgvector`; Managed Valkey is Redis-client compatible; Spaces exposes an S3-compatible API and presigned URLs. | One vendor and one nearby region reduce account and networking sprawl. App specs, managed data services, automatic platform patching, and VPC access are friendly to a solo operator. Containers are stateless, which correctly forces documents into object storage. | A non-HA floor using three 512 MiB app components (US$5 each), 1 GiB Managed PostgreSQL (US$15.15), 1 GiB Managed Valkey (US$15), and Spaces (US$5) is about **US$50.15/month** before OIDC, email, observability, transfer, backups, staging, tax, or larger production sizing. HA and realistic Node memory increase this materially. | The app containers and data protocols remain portable; the App spec/VPC configuration is vendor-specific. Spaces is only partially S3 compatible: no cross-region copy, limited lifecycle/encryption controls, no built-in backups, and its current limits page says `ListObjectsV2` pagination is unsupported. That last point must pass the HRIS contract test or the application must avoid relying on it. Spaces data is encrypted on physical disks and in transit, but customer-managed object encryption is SSE-C rather than a bucket-level KMS policy. |
| **AWS ECS on Fargate + RDS PostgreSQL + ElastiCache + S3 in Singapore** | Three ECS services/task definitions map directly to web, API, and worker. Fargate supports 0.25-vCPU/512-MiB Linux tasks; RDS supports PostgreSQL extensions including `pgvector`; ElastiCache offers Redis/Valkey-compatible managed caching; S3 is the reference API rather than a compatibility subset. Cognito can keep identity in the same cloud if selected separately. | No server or cluster nodes to manage, but the operator must still own VPC/subnets, security groups, load balancing, IAM task roles, ECR, Secrets Manager, logs/alarms, RDS, cache topology, backups, and infrastructure as code. ECS deployment circuit breakers can automatically roll back failed rolling deployments. This is the largest day-two surface for one developer. | Usage-based task CPU/memory/storage plus RDS, cache, S3, load balancer, NAT or public networking, IPv4, logs, backups, KMS, data transfer, and support. Fargate is per-second with a one-minute minimum, but AWS explicitly lists networking/logging as additional charges. A Singapore estimate must be built in AWS Pricing Calculator; US-East examples should not be reused as a budget. | Containers and application protocols remain portable; IAM, VPC, ECS, CloudFormation/CDK, observability, and service wiring create substantial AWS-specific infrastructure. It offers the strongest single-cloud service depth and least S3 ambiguity, but portability is an architectural discipline rather than a zero-cost migration. |

Primary sources:

- Render: [service types](https://render.com/docs/service-types), [background workers and BullMQ](https://render.com/docs/background-workers), [private networking](https://render.com/docs/private-network), [Singapore region](https://render.com/docs/regions), [Docker deployments](https://render.com/docs/docker), [Key Value persistence](https://render.com/docs/key-value), [PostgreSQL backups](https://render.com/docs/postgresql-backups), and [`pgvector` support](https://render.com/docs/postgresql-extensions).
- DigitalOcean: [App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/), [workers](https://docs.digitalocean.com/products/app-platform/how-to/manage-workers/), [Singapore VPC mapping](https://docs.digitalocean.com/products/app-platform/how-to/enable-vpc/), [managed database pricing](https://www.digitalocean.com/pricing/managed-databases), [`pgvector` support](https://docs.digitalocean.com/products/vector-databases/postgresql/), [Spaces pricing](https://docs.digitalocean.com/products/spaces/details/pricing/), [S3 compatibility](https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/), [Spaces limits](https://docs.digitalocean.com/products/spaces/details/limits/), and [encryption/shared responsibility](https://www.digitalocean.com/security/shared-responsibility-model-spaces).
- AWS: [ECS/Fargate model](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html), [Fargate task constraints](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html), [Fargate pricing](https://aws.amazon.com/fargate/pricing/), [RDS PostgreSQL extensions](https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-extensions.html), [ElastiCache pricing models](https://aws.amazon.com/elasticache/pricing/), and [deployment rollback](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html).

### Deployment decision constraints exposed

Before choosing an arrangement, record:

- **Operating model:** shared SaaS, dedicated managed deployment per agency, or agency-hosted; the three have different cost and isolation consequences.
- **Availability:** whether one instance/node per component is acceptable for MVP, and which components require multi-zone standby or horizontal redundancy.
- **Recovery:** target RPO/RTO, backup retention, export destination, and a priced restore drill for PostgreSQL, object storage, and identity profiles.
- **Locality/procurement:** accepted countries/regions and required vendor security, privacy, support, contract, and government-procurement review.
- **Budget:** monthly ceiling for production and staging at realistic Node memory, plus OIDC, email, telemetry, transfer, backups, and support.
- **Exit test:** restore PostgreSQL to another managed provider, copy objects with checksums and versions, export identity profiles, and redeploy the three containers from documented environment variables.

## Decision-ready conclusion

The research narrows the next tickets without choosing for them:

- **Select the OIDC authentication provider:** Auth0, Cognito, and ZITADEL Cloud are technically viable only as fully specified plan/region/revocation configurations. The selection must explicitly price the required MFA, environment separation, audit, and logout behavior and accept an exit path.
- **Select the local S3-compatible object-storage service:** SeaweedFS and Garage are active candidates; RustFS is a maturity watchlist candidate. MinIO Community Server should not be treated as the maintained default. Selection should be made by running the shared S3 contract suite, not by compatibility claims.
- **Select the initial deployment model:** Render, DigitalOcean, and AWS all fit the three-process modular monolith without Kubernetes. The deciding variables are operating model, availability/RPO/RTO, locality/procurement, budget, and tolerated day-two complexity.

No provider or deployment arrangement is selected by this research.
