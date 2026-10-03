# Agency seal

An administrator opens **Organization → Agency Profile → Seal and building photo**
to manage the official seal shown on Invitation Activation. A selected file is
staged locally until **Save seal**. The preview has **Set password** and **Signed
in** tabs. Removal requires confirmation.

Issue #400's implementation decisions were confirmed by Xenrya:

- Reuse `organization.agency.update` for saves, replacements, and removals, and
  `organization.agency.read` for settings reads.
- Save immediately, independently of effective-dated Agency Profile versions.
  Each change writes an Audit Event in the same database transaction.
- Accept single-frame PNG or JPEG images, at most 2 MB (2,097,152 bytes), and at
  least 600 × 600 pixels. Image decoding also caps inputs at 40 million pixels.
  The API checks the actual image format and decodes it before uploading.

The database stores the private object's opaque key, file metadata, content hash,
and change attribution. File bytes live in S3-compatible storage. Previous
private objects remain stored when a seal is replaced or removed; the Audit Log
retains their before/after file metadata. A failed save attempts to delete its new
object. A settings save or removal includes the seal ID the administrator saw,
so a concurrent change returns a conflict instead of silently overwriting it.

Invitation lookup validates the token, expiry, Agency status, and requested roles
before reading the Agency's seal. It returns a signed read URL valid for up to
five minutes, bounded by the invitation's remaining lifetime. Invalid invitations
receive no seal URL. Settings reads also issue five-minute URLs after authorization.
No public object URL or storage key appears in the settings DTO. Invitation stamps
and both settings previews keep their loaded images mounted, so switching steps
or tabs does not require another storage request after a signed URL expires.

Agencies without a seal keep the gold ring with their acronym. Sign-in and
Password Reset keep LingkodHR's letterhead. Building photo upload belongs to
issue #401; this page currently keeps the drawn sunrise.

Run the browser acceptance test from the repository root:

```bash
pnpm --filter @lingkod-hr/web exec playwright test e2e/agency-seal.spec.ts --headed --project=chromium
```
