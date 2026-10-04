# Agency seal and building photo

An administrator opens **Organization → Agency Profile → Seal and building photo**
to manage the official seal and the optional building photo shown on Invitation
Activation. A selected file is staged locally until **Save seal** or **Save
photo**. The preview has **Set password** and **Signed
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
Password Reset keep LingkodHR's letterhead.

## Building photo

Issue #401 follows the seal's permission, storage, signing, concurrency, and
audit rules. Its placeholder limits are single-frame PNG or JPEG images, at most
5 MB (5,242,880 bytes), and at least 1200 pixels wide.

- **Show on Invitation screens** keeps a photo but hides it when turned off. The
  change saves immediately and writes `AGENCY_PHOTO_SHOWN` or
  `AGENCY_PHOTO_HIDDEN`; repeating the current setting writes nothing.
- Saving or replacing a photo always shows it.
- Invitation lookup signs the photo only while it is shown. The live preview
  follows the toggle and any staged photo.
- On Invitation Activation, the photo replaces the drawn sunrise. A navy dawn
  tint lifts with each step and is gone once the User is in. Terminal problems
  grey the photo out. With reduced motion on, the final state shows without
  animation. If the signed URL fails to load, the drawn sunrise returns.

Agencies with no photo, or with the photo turned off, keep the drawn sunrise.
Sign-in and Password Reset always keep it.

Run the browser acceptance tests from the repository root:

```bash
pnpm --filter @lingkod-hr/web exec playwright test e2e/agency-seal.spec.ts e2e/agency-building-photo.spec.ts --headed --project=chromium
```
