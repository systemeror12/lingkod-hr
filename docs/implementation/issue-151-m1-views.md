# M1 view standardization, issue #151

The application retains Noto Sans, light canvas and cobalt. The protected workspace uses the available width. Existing Employee routes remain valid; nested routes keep the authorized navigation destination active. Agency Profile and Organization Units have separate workspace links within Organization.

Record selection uses the Next.js router and URL search parameters. Form values remain local to their owning components. The existing Dialog component supports page Forms while lifecycle confirmations retain their modal boundary. Shared Field presentation associates validation errors with controls. No schema, API contract or domain transition changes are included.

| M1 surface                       | Treatment and retained behavior                                                                                        | Navigation context                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Protected shell, Dashboard       | Full-width protected workspace, common heading and table density; Dashboard retains its task layout and Agency Context | Nested destinations remain current                                         |
| Loading, error, not-found        | Existing state surfaces retain explicit messages and bounded behavior within shared workspace                          | Existing protected routes                                                  |
| Agency Profile                   | Selected Agency Form and retained versions; no Agency list                                                             | `workspace=agency`, `agencyVersion`                                        |
| Organization Units               | Full-width hierarchy and selected Unit Form; register, draft placement, lifecycle confirmations and history retained   | `unit`, `asOf`, `section=history` or `successor`                           |
| Staffing Authorities             | Compact register and selected Form with evidence and transition history                                                | `record`, `view=form`                                                      |
| Qualification Standards          | Compact register and selected Form with version, evidence and correction access                                        | `record`, `view=form`                                                      |
| Plantilla Positions              | Full-width catalog and selected Form; definition, evidence, versions and lifecycle remain separate                     | `record`, `asOf`, `q`, `view=form`                                         |
| Employees, creation, detail      | Existing directory and record routes; common fields and density; preboarding and Membership linking retained           | Existing `/employees/new` and `/employees/:id`                             |
| PDS, Employee PDS                | Sectioned page editor; submission, correction, output and evidence workflows retained                                  | Existing own/Employee routes and `pdsVersion`                              |
| Employee Documents, My Documents | Existing classified links, upload and evidence operations; selected document detail is a Form                          | Employee/own route and `document`; private retrieval URLs remain transient |
| Government Identifiers           | Masked register and focused reveal/replacement/invalidation operations; retained history Form                          | Employee route and `identifierHistory`                                     |
| Payroll Bank Accounts            | Masked register and existing controlled operations; retained history Form                                              | Employee route and `bankHistory`                                           |
| SALN Compliance, My SALN         | Filing metadata and history Forms; remains compliance tracking                                                         | Employee/own route, `saln`, `salnHistory`                                  |
| Personnel Baselines              | Register and selected Form; review/effectuation remain confirmations                                                   | `record`, `view=form`, `section=history`                                   |
| Personnel Actions                | Register and selected Form; authority checks and effectuation remain with existing owners                              | `record`, `view=form`, `section=history`                                   |
| Service Records                  | Selected snapshot Form and chronological service/output layout; correction confirmation retained                       | `record`, `view=form`, `section=history`                                   |
| Audit Log                        | Read-only list and selected event Form; existing pagination and redaction retained                                     | `record`, `view=form`                                                      |
| Users & Access                   | Existing restricted invitation task form inherits protected presentation                                               | Existing route                                                             |
| Invitation entry/error           | Existing public Noto Sans/cobalt task layout reviewed; stays outside protected shell                                   | Existing public routes                                                     |

Tree/Form is used for Personnel Baselines and Personnel Actions. No additional Kanban board is needed to deliver their existing approval actions; this work does not introduce drag-driven transitions or change the accepted downstream Recruitment and Appointment views.

## Verification

- Setup gate passed with Node 24.19.0, frozen dependencies, healthy Compose infrastructure, 68 migrations with none pending, API/worker/OIDC health and local OIDC login to Dashboard.
- Focused navigation and server-rendered Field/Form checks passed. They cover nested destination matching, permission visibility, filter/effective-date preservation, accessible labels/errors and inline Form semantics.
- Hosted CI `pnpm validate` passed: formatting, lint, typecheck, repository tests and production build. Tests: 227 passed and 50 skipped.
- Shell HTTP checks returned 200 for Dashboard, Organization Units, Agency Profile, Employees, Staffing Authorities, Qualification Standards, Plantilla Positions, Personnel Baselines, Personnel Actions, Audit, Service Records, My PDS, My Documents, My SALN and Users & Access, without an application error boundary in the returned HTML.
- Existing browser assertions are updated for migrated Forms, with added missing-record reload/Back, failed Employee creation and SALN retry cases. Hosted CI Chromium execution passes: 29 tests across 18 files.
- No local visual or manual keyboard pass was run. The developer explicitly limited local verification to shell and repo-native checks; hosted CI supplied the repository's automated browser coverage.

## Review

- Standards review: addressed inline Form prop/ref forwarding, focus restoration after navigation and effective-dated Organization selection. Follow-up review found no remaining blockers.
- Specification review: documented all M1 surfaces and M2 boundaries; added Service Record history pagination, deduplication and chronological ordering; corrected SALN and bank pending/error handling and document upload retry idempotency. All reported findings are addressed.

## M2 handoff

Recommendations 4 and 5 remain assigned to existing M2 tickets. Plantilla ownership, recruitable vacancy, reservation/release and incumbency effects belong to #142, #145, #146, #148 and #149. The exact Assumed Appointment Contract and atomic coordinator across Appointment, Personnel, Plantilla and Recruitment belong to #149. This M1 change does not implement those effects or substitute baseline adoption for assumption to duty.
