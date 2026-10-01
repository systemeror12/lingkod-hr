# Philippine government authentication requirements for an HRIS

**Research date:** 2026-10-01 (Asia/Manila)

**Wayfinder question:** Which official Philippine sources impose binding requirements on how a national government agency's (NGA) HRIS authenticates users and protects credentials: password length and composition, reuse and expiry, failed-attempt lockout, MFA, session timeout, credential and secret storage, and audit of authentication events? Where official sources are silent, what do the usual non-authoritative baselines say?

## Scope and method

The note supports LingkodHR's move from an external OIDC provider to in-house login (password + TOTP + recovery codes, Argon2id). It records constraints only. Choosing values is left to the decision tickets on password rules, brute-force protection, password reset, and TOTP secret storage.

Philippine findings come from primary texts: the Data Privacy Act (RA 10173) and its IRR as published by the National Privacy Commission (NPC), the signed NPC circulars, advisories and FAQ, DICT memorandum circulars filed with the UP Law Center, and the E-Governance Act (RA 12254) and its 2026 IRR. Baseline guidance comes from NIST SP 800-63B-4 (final, August 2025) on pages.nist.gov and from OWASP ASVS 5.0.0 at the `v5.0.0_release` tag in the official repository.

Wording in quotation marks is copied from the source. Other wording is a close paraphrase. Anything not read in a primary text is marked **unverified**.

## Findings at a glance

1. **No Philippine source sets a numeric authentication parameter.** No current national rule fixes a password length, a composition rule, a reuse or expiry rule, a lockout threshold, a session timeout, a hashing algorithm, or a key-custody scheme for a government system. The binding rules are outcome rules, and the agency has to turn them into a documented policy.
2. **NPC Circular 2023-06 is the controlling security issuance and binds NGAs.** It took effect on 30 March 2024, its 12-month transitory period has ended, and it repealed NPC Circular 16-01. For an HRIS it requires three things:
   - **§11:** a Password Policy that the agency issues and enforces, with passwords "of sufficient strength and uniqueness to deter password attacks".
   - **§16:** "secure authentication mechanisms, such as multifactor authentication or secure encrypted links" for personnel's online access to sensitive personal information, with access rights and authentication "defined and controlled by a System Management Tool".
   - **§29:** authentication-attempt logs kept longer than general system logs, with backup and archive.
3. **An HRIS almost certainly falls under §16's MFA clause.** It holds sensitive personal information as the DPA defines it: marital status, age, health, education, and government-issued numbers such as SSS numbers and tax returns. MFA is the named example. A "secure encrypted link" is the only alternative the text names, and TLS alone is a weak reading of that phrase. A product that cannot enforce MFA leaves the agency arguing an exception.
4. **The DPA IRR §28(g) lists "encryption of personal data during storage and while in transit, authentication process" among technical measures, prefixed by "where appropriate".** No current rule names an algorithm or key size. The AES-256 recommendation and the unconditional MFA mandate came from **repealed** NPC Circular 16-01 and must not be cited as current.
5. **DICT is about to supply the missing technical standard but had not, as far as could be verified.** RA 12254 IRR §38 directs DICT to publish a list of Minimum Information Security Standards (MISS), naming ISO/IEC 27001, the NIST CSF 2.0 "and its accompanying Security Publications", the CIS Controls, and others, within 90 days of effectivity. Agencies must prove compliance within one year of the list. IRR §15.5 separately requires CSC and DICT to issue mandatory minimum cybersecurity standards for every HCMIS (HR system) within 90 days. **Neither issuance could be located or verified**, because dict.gov.ph blocks automated access. Both must be checked before any value is final, since either could turn NIST guidance into a binding rule.
6. **NIST SP 800-63B-4 and OWASP ASVS 5.0 supply the numbers, as guidance only.**
   - Passwords: at least 15 characters if single-factor, or at least 8 if used only inside MFA. Allow at least 64. No composition rules. No periodic expiry. Check against a blocklist.
   - Failed attempts: at most 100 consecutive failures per authenticator before it is disabled.
   - Storage: salted password hashing. Hash recovery codes and use each only once.
   - Sessions (AAL2): reauthenticate within 24 hours overall and after 1 hour of inactivity.
   - Logging: ASVS 16.3.1 requires logging every authentication operation, successful or not.

## Which sources bind an NGA HRIS

| Source | Status on research date | Binds an NGA's system? | Authentication content |
|---|---|---|---|
| **RA 10173, Data Privacy Act** §§20, 22, 23 | In force | **Yes.** §22 makes "the head of each government agency" responsible for securing sensitive personal information (SPI). §23 governs agency personnel's access to SPI. | Outcome duties only: "reasonable and appropriate organizational, physical and technical measures", a security policy, and monitoring. No parameters. |
| **DPA IRR** §§25–31 | In force, but NPC Circular 2023-06 §39 deems inconsistent IRR provisions "repealed or modified" | **Yes.** Binds PICs and PIPs, and Rule VII is specific to government. | §28(g) encryption and "authentication process", §26(e)(3) access-management policies, §31 security clearance for online access to SPI. |
| **NPC Circular 2023-06**, Security of Personal Data in the Government and the Private Sector | Effective 30 March 2024 (FAQ XI). Twelve-month transitory period (§37) has ended. | **Yes.** §1 covers "all natural or juridical persons engaged in the processing of personal data". §3(J) defines "Government Agency" to include NGAs. The NPC FAQ (I) says it "covers both the government and the private sectors." | §§11, 13, 15, 16, 29: password policy, access control, MFA for SPI, and authentication-log retention. |
| NPC Circular 16-01, Security of Personal Data in Government Agencies | **Repealed** by NPC Circular 2023-06 §39 | No longer | Historical only: AES-256 "recommended" (§8) and "must use multi-factor authentication" for all online access (§18). |
| NPC Advisory 2025-02, Privacy Engineering in Systems Life Cycle Processes (27 Aug 2025) | Current | Guidance. The NPC describes advisories as "guidelines", not rules. | Lists "encryption for data at rest and in transit", "access controls", and traceability of access or changes to personal information (§ on Designing and Development). No parameters. |
| **DICT MC 006, s. 2017**, protection of government agencies under NCSP 2022 | Signed 1 Aug 2017. Its plan, NCSP 2022, has been superseded by NCSP 2023–2028 (EO 58, s. 2024). Not expressly repealed. | Addressed to "all government agencies" | No authentication controls. It requires an agency CERT, makes the agency head the Cybersecurity Officer, and says personal-data security "shall be in conformance with the issuances from the National Privacy Commission". |
| **DICT MC 005, s. 2017**, protection of CII under NCSP 2022 | Signed 1 Aug 2017. Same supersession question as MC 006. | Partly. §IV.A: "Government agencies are hereby ordered to adopt the Code of Practice stipulated in PNS ISO/IEC 27002". "Government" is listed as a CII sector. | ISO/IEC 27002 contains authentication controls. **Unverified:** the standard is paywalled and its text was not reviewed. As far as is known it is a "should"-level code of practice without numeric thresholds. |
| **RA 12254, E-Governance Act** (5 Sep 2025) §§11, 23, 24 | In force | **Yes.** §24 covers "all agencies, offices, and instrumentalities of the national and local governments". | Risk-commensurate security, periodic testing, and compliance with DICT standards. No parameters. |
| **RA 12254 IRR** (signed 24 Mar 2026) §§15.5, 25, 38 | In force after publication. Exact effectivity date **unverified**. | **Yes.** §25(c) requires covered entities to "comply with the Minimum Information Security Standards (MISS) set by the DICT". | MISS list and HCMIS cybersecurity standards are **pending or unverified** (see finding 5). |
| DICT Department Circular 007, s. 2020, updated cryptographic protocols for government websites | Reported issued 16 Apr 2020 | Reported to cover government web servers | **Unverified:** the primary text could not be retrieved. Secondary reports say it requires migrating to current TLS versions. It concerns transport, not authentication. |
| NCSP 2023–2028 (adopted by EO 58, s. 2024) | In force as a plan | EO 58 §1 directs NGAs to "formulate, adopt and implement their cybersecurity plans" under it | **Unverified:** the plan text could not be retrieved. EO 58 itself names no authentication controls. |
| CSC issuances | n/a | n/a | **No CSC rule on HRIS authentication was found.** The relevant CSC hook is the pending joint CSC–DICT HCMIS standard under RA 12254 IRR §15.5. |
| COA issuances | n/a | n/a | **No COA rule on authentication was found.** COA Circular 97-003 (IT resources) could not be retrieved, and secondary sources disagree on its subject. |

**Scope caveat.** The NPC's circulars index repeats the Administrative Code definition, under which circulars are "applicable to individuals and organizations outside the Government". This is a generic label. NPC Circular 2023-06's own §1 and §3(J), and the NPC FAQ, state that it applies to government agencies. DPA §§22–23 and IRR Rule VII bind agencies directly in any case.

**Who the obligation falls on.** The agency is the personal information controller (PIC), and its head answers under DPA §22. LingkodHR, if operated by a vendor, would be a personal information processor (PIP) bound by contract (Circular 2023-06 §§10, 14). The product has to make the agency's compliance possible. The rules do not bind the code directly.

## Requirement by requirement

### 1. Password length and composition

| | |
|---|---|
| **Binding PH rule** | NPC Circular 2023-06 **§11**: "Passwords or passphrases used to access personal data should be of sufficient strength and uniqueness to deter password attacks. Each PIC or PIP shall issue and enforce a Password Policy." §3(M) defines a Password Policy as "a document or set of rules that passwords must satisfy". Binds NGAs. |
| **What it does not say** | No minimum length, character classes, or entropy. The duty is to write the policy down and enforce it in the system. |
| **NIST SP 800-63B-4 §3.1.1** | Minimum **15** characters when the password is the only factor. Passwords used only within MFA may be shorter but "SHALL require them to be a minimum of eight characters". Maximum length SHOULD be at least **64**. SHOULD accept all printing ASCII, space, and Unicode, with NFC normalization before hashing. "SHALL NOT impose other composition rules". SHALL check new passwords against a blocklist of common, expected, or compromised values, including context words such as the service name and username. SHALL allow password managers and autofill. No hints and no security questions. |
| **OWASP ASVS 5.0** | 6.2.1: at least 8 characters, with 15 "strongly recommended". 6.2.9: at least 64 permitted. 6.2.5: no composition rules. 6.2.4: check against at least the top 3,000 passwords. 6.2.12: check against breached passwords. 6.2.11: block a documented list of context-specific words. 6.2.7: allow paste. 6.2.8: no truncation. |

### 2. Password reuse and expiry

| | |
|---|---|
| **Binding PH rule** | **Silent.** §11's "uniqueness" is the only hook. It reads as "not shared or common", not as a password-history count. No official source requires or forbids periodic expiry. |
| **NIST SP 800-63B-4 §3.1.1.2** | "SHALL NOT require subscribers to change passwords periodically. However, verifiers SHALL force a change if there is evidence that the authenticator has been compromised." No password-history requirement. |
| **OWASP ASVS 5.0** | 6.2.10: a password "stays valid until it is discovered to be compromised or the user rotates it. The application must not require periodic credential rotation." 6.2.3: changing a password requires the current and the new password. |

### 3. Failed-attempt lockout and brute-force protection

| | |
|---|---|
| **Binding PH rule** | **Silent on thresholds.** The general duties are DPA §20(c)(1), safeguards "against accidental, unlawful or unauthorized usage", and Circular 2023-06 §11, passwords strong enough to "deter password attacks". |
| **NIST SP 800-63B-4 §3.2.2** | The verifier SHALL limit consecutive failed attempts on one authenticator for one account to **no more than 100**, then disable that authenticator until it is rebound. "The limit of 100 attempts is an upper bound, and agencies MAY impose lower limits." It MAY add bot challenges, increasing waits ("e.g., 30 seconds up to an hour"), or risk signals. After a successful authentication it SHOULD reset the count. Out-of-band codes: issuing a new code "SHALL NOT reset the failed authentication count". TOTP under 64 bits SHALL be rate-limited. |
| **OWASP ASVS 5.0** | 6.1.1: document how rate limiting, anti-automation, and adaptive response stop credential stuffing and brute force, and how they "prevent malicious account lockout". 6.3.1: implement those controls. 6.3.8: failed logins, registration, and forgot-password must not reveal whether an account exists. |

### 4. Multi-factor authentication

| | |
|---|---|
| **Binding PH rule** | NPC Circular 2023-06 **§16**: "A PIC or PIP shall implement secure authentication mechanisms, such as multifactor authentication or secure encrypted links, when providing personnel online access to sensitive personal information, privileged information, and a high volume of personal data. Such user access rights and authentication mechanisms must be defined and controlled by a System Management Tool." §3(S) defines a System Management Tool as "a software system that facilitates the administration of user passwords and access rights". Binds NGAs. |
| **Related binding rules** | §13: an Access Control Policy on a need-to-know basis, "authentication methods and regular monitoring", and a security clearance per authorized person, with a copy filed with the DPO. DPA §23(a) and IRR §31(a): no government employee may access SPI "through online facilities" without a security clearance from the head of the source agency. §15: each user signs the Acceptable Use Policy "before being allowed access". The NPC FAQ (VI) says "merely having a username, password, and approver may not be sufficient". |
| **Application to an HRIS** | DPA §3(l) defines SPI to include marital status, age, health, education, and data "issued by government agencies peculiar to an individual which includes, but not limited to, social security numbers, previous or current health records, licenses … and tax returns". HRIS users who see employee records see SPI. "High volume" has no definition. The FAQ (IV) points to the NPC Circular 2022-04 registration criteria as a baseline. |
| **What it does not say** | MFA is an example, not a sole mandate. No factor type is required, and phishing resistance is not required. The repealed Circular 16-01 §18 had said agency personnel "must use multi-factor authentication". The current text is softer. |
| **NIST SP 800-63B-4 §2.2** | AAL2 permits a password plus a single-factor OTP (TOTP) or a look-up secret. Verifiers "SHALL offer at least one phishing-resistant authentication option at AAL2". US federal agencies SHALL require it for staff, which does not apply here. OTP, look-up secrets, and passwords are each stated to be "not phishing-resistant". TOTP: the key must be at least 112-bit, accepted only once while valid, with a defined lifetime. Email SHALL NOT be used for out-of-band authentication. |
| **OWASP ASVS 5.0** | 6.3.3: MFA or a combination of single factors is required to access the application. L3 requires a hardware, phishing-resistant factor. 6.5.1: TOTP and lookup secrets are usable once. 6.5.5: TOTP maximum lifetime 30 seconds. 6.5.8: TOTP checked against a trusted server time. 6.6.1: SMS or phone only with a stronger alternative such as TOTP, and never at L3. 6.3.6: email is not an authentication factor at L3. |

### 5. Session timeout

| | |
|---|---|
| **Binding PH rule** | **Silent.** No official source sets an inactivity or absolute session timeout. |
| **NIST SP 800-63B-4 §§2.1.3–2.3.3, 5** | AAL1: overall timeout SHOULD be at most 30 days. AAL2: overall timeout SHOULD be at most **24 hours** and inactivity timeout SHOULD be at most **1 hour**. After an inactivity timeout within the overall window, reauthentication with password alone MAY be allowed. AAL3: overall SHALL be at most 12 hours and inactivity SHOULD be at most 15 minutes. Session secrets need at least 64 bits from an approved RBG and are invalidated at logout. Cookies SHALL be HTTPS-only. They SHOULD be `HttpOnly`, `__Host-`, and `SameSite=Lax/Strict`, and SHALL NOT hold cleartext personal information. Session secrets SHOULD NOT go in Local Storage. Agencies SHALL document their limits in a system security plan. |
| **OWASP ASVS 5.0** | 7.1.1: document inactivity and absolute lifetime and justify deviations from 800-63B. 7.2.3: reference tokens of at least 128 bits. 7.2.4: new token on every authentication. 7.4.1: termination invalidated server-side. 7.4.2: all sessions end when an account is disabled. 7.4.3: offer to end other sessions after any factor change. 7.4.5: administrators can end a user's sessions. 7.5.1: full reauthentication before changing MFA or recovery details. |

### 6. Credential and secret storage: hashing, encryption at rest, key custody

| | |
|---|---|
| **Binding PH rule** | DPA IRR **§28(g)** ("where appropriate"): "Encryption of personal data during storage and while in transit, authentication process, and other technical security measures that control and limit access." Circular 2023-06 **§11**: "All personal data that are processed must be adequately protected through industry standards and best practices." DPA **§22**: SPI held by government "shall be secured, as far as practicable, with the use of the most appropriate standard recognized by the information and communications technology industry, and as recommended by the Commission." DPA §23(b)(3) and IRR §31(b)(2)(c) require "the most secure encryption standard recognized by the Commission" only for approved **off-site** access to SPI. |
| **What it does not say** | No rule addresses password hashing as such. None names an algorithm, key size, or key-custody arrangement, or requires an HSM or KMS. The NPC has not currently "recognized" a specific encryption standard. Its only named standard, AES-256 in Circular 16-01 §8, was repealed. |
| **NIST SP 800-63B-4** | Passwords: "SHALL be salted and hashed using a suitable password hashing scheme". Salt at least 32 bits. A cost factor as high as practical, raised over time. The scheme and cost are stored per hash. An approved scheme from SP 800-132 "SHOULD be used". Argon2id is not in SP 800-132, but this is a SHOULD. A keyed pepper SHOULD be added, with the key "stored separately from the hashed passwords", ideally in an HSM or TEE. Look-up secrets and saved recovery codes SHALL be hashed. Those under 112 bits use a salted password-hashing scheme. TOTP verifier keys "SHALL be strongly protected against unauthorized disclosure by access controls that limit access to the keys to only those software components that require access". Encryption at rest is not mandated. |
| **OWASP ASVS 5.0** | 11.4.2: passwords use an approved, computationally intensive KDF. Appendix C approves **argon2id** (t=1, m≥46 MiB; t=2, m≥19 MiB; or t≥3, m≥12 MiB; p=1), scrypt, bcrypt (cost ≥10), and PBKDF2-HMAC-SHA-256 (≥600,000 iterations). 6.5.2: lookup secrets under 112 bits hashed with an approved password hash and a 32-bit salt. 13.3.1: a secrets-management solution "such as a key vault" for backend secrets, explicitly including "keys and seeds for time-based tokens". Secrets never in source or build artifacts. L3 requires a hardware-backed solution. 11.1.1: a documented key-management policy and lifecycle (e.g., NIST SP 800-57). |

### 7. Audit of authentication events

| | |
|---|---|
| **Binding PH rule** | NPC Circular 2023-06 **§29**: logs are kept "as long as deemed necessary and appropriate based on best practices and industry standards". "Security logs that record information about authentication attempts and security incidents shall be retained for longer periods than general system logs". Incident logs are kept "for a specified period required by the NPC, even if it exceeds their retention policies". PICs "shall implement backup and archive mechanisms for their logs". §13 requires "regular monitoring". DPA §20(c)(4) requires "regular monitoring for security breaches". IRR §26(e)(3) requires "policies for access management, system monitoring". |
| **What it does not say** | No list of events to log, no log fields, and no numeric retention period. Retention is a records-policy value for the agency, read with its NAP records schedule. See `research/official-forms-security-records-baselines.md` §3. |
| **NIST SP 800-63B-4** | Silent on audit logging. It defers to "the moderate baseline security controls defined in [SP800-53]" (§2.4.1). It does require subscriber **notifications** for authenticator binding, account recovery, and recovery-code replacement (§4.6). |
| **OWASP ASVS 5.0** | 16.3.1: "all authentication operations are logged, including successful and unsuccessful attempts", with factor type. 16.2.1: who, what, when, and where. 16.2.5: never log credentials, and hash or mask session tokens. 16.4.2: logs protected from modification. 16.4.3: shipped to a logically separate system. 6.3.5 and 6.3.7 (L3): notify users of suspicious attempts and of credential changes. |

### 8. Password reset and account recovery

| | |
|---|---|
| **Binding PH rule** | **Silent.** The general duties under §§11, 13, and 16 apply. A reset path that bypasses the second factor would undercut §16. |
| **NIST SP 800-63B-4 §4.2** | Replacing a forgotten password while the user still holds another bound authenticator is binding a new authenticator, not account recovery. Saved recovery codes need at least 64 bits from an approved RBG, are stored hashed, are rate-limited, and are invalidated on use with a new code issued. Recovering an AAL2 account requires two recovery codes from different methods, or one code plus a bound single-factor authenticator, or repeated identity proofing. Every recovery sends a notification. Issued codes sent by email are valid for at most 24 hours. |
| **OWASP ASVS 5.0** | 6.4.3: reset "does not bypass any enabled multi-factor authentication mechanisms". 6.4.4: identity re-proofing at enrollment level when an MFA factor is lost. 6.4.6 (L3): administrators may start a reset but cannot choose the user's password. 6.4.1: system-generated initial secrets expire quickly and cannot become the long-term password. |

## Constraints this places on the decision tickets

These follow from the binding text above. They are not design choices.

- **Password rules:** the product must enforce a written Password Policy that the agency can adopt (§11). Philippine law sets no numbers, so a NIST-aligned policy is defensible: length floor, at least 64 maximum, no composition rules, no periodic expiry, blocklist. The policy must be documented and enforced by the system, not merely advised. If agencies may tighten it, the floor must not be lowerable below the shipped minimum.
- **Brute-force protection:** no Philippine number exists. The NIST cap of 100 consecutive failures is an upper bound. Agency lockout must not become a denial-of-service lever (ASVS 6.1.1).
- **MFA:** §16 makes MFA the default reading for any user with online access to employee SPI. The access rights and authentication mechanisms must be administrable in-system, which is the §16 "System Management Tool". TOTP satisfies "multifactor" but is not phishing-resistant. If DICT's MISS list adopts NIST SPs, AAL2's "offer at least one phishing-resistant option" could become relevant later.
- **Password reset:** nothing local governs it. Under the guidance, reset must not bypass TOTP. Recovery codes are hashed, single-use, at least 64 bits, and trigger notification.
- **TOTP secret storage:** no Philippine rule names a method. IRR §28(g) (encryption during storage) and DPA §22 (most appropriate industry standard) support encrypting seeds at rest with a key held outside the database (ASVS 13.3.1). NIST requires at least strict access control.
- **Audit:** authentication attempts must be logged and kept longer than general logs, with backup and archive (§29). Credentials must never be logged.
- **Recheck before finalizing:** confirm whether DICT has published the MISS list (RA 12254 IRR §38) and whether CSC and DICT have issued the HCMIS minimum cybersecurity standards (§15.5). Either could make specific controls mandatory for every government HR system.

## Could not verify

- RA 12254 IRR publication and effectivity date, and therefore the MISS and HCMIS deadlines. dict.gov.ph and officialgazette.gov.ph returned Cloudflare 403s to automated requests. The IRR text was read from LawPhil.
- Whether the DICT MISS list or the CSC–DICT HCMIS standards have been issued.
- Text of the NCSP 2023–2028 plan, DICT DC 007 s. 2020, and COA Circular 97-003.
- Content of ISO/IEC 27002 authentication controls (paywalled), and whether DICT MC 005 s. 2017's ISO/IEC 27002 order survives the NCSP 2023–2028 transition and RA 12254.
- The RA 12254 statute and IRR were read from LawPhil (secondary reproduction), not the Official Gazette.

## Sources

Philippine primary sources:

- National Privacy Commission, [RA 10173 Data Privacy Act of 2012](https://privacy.gov.ph/data-privacy-act/) (§§3(l), 20, 22, 23)
- National Privacy Commission, [Implementing Rules and Regulations of the DPA](https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/) (§§25–33)
- National Privacy Commission, [Circular 2023-06, Security of Personal Data in the Government and the Private Sector](https://privacy.gov.ph/wp-content/uploads/2024/03/NPC-Circular-Repeal-16-01-Signed.pdf)
- National Privacy Commission, [FAQ on Circular 2023-06](https://privacy.gov.ph/wp-content/uploads/2024/12/v12-19-2024_FAQ-NPC-Circular-2023-06_NNJ_JDN.pdf)
- National Privacy Commission, [Circular 16-01 (repealed)](https://privacy.gov.ph/wp-content/uploads/2022/01/Sgd-NPC-Circular-16-01-Security-of-Personal-Data-in-Government-Agencies.pdf)
- National Privacy Commission, [Advisory 2025-02, Privacy Engineering in Systems Life Cycle Processes](https://privacy.gov.ph/wp-content/uploads/2025/12/NPC_Advisory2025-02.pdf)
- National Privacy Commission, [Advisories and circulars index](https://privacy.gov.ph/pips-and-pics/advisories-circulars/) (checked for successors through Advisory 2026-03)
- DICT, [Memorandum Circular 006, s. 2017](https://cms-cdn.e.gov.ph/DICT/pdf/Memorandum-Circular-006.pdf)
- DICT, [Memorandum Circular 005, s. 2017](https://cms-cdn.e.gov.ph/DICT/pdf/Memorandum-Circular-005.pdf)
- [RA 12254, E-Governance Act](https://www.lawphil.net/statutes/repacts/ra2025/ra_12254_2025.html) (LawPhil reproduction)
- [IRR of RA 12254](https://lawphil.net/statutes/repacts/ra2026/irr_12254_2026.html) (LawPhil reproduction)
- [Executive Order No. 58, s. 2024](https://lawphil.net/executive/execord/eo2024/eo_58_2024.html) (LawPhil reproduction; [Official Gazette entry](https://www.officialgazette.gov.ph/2024/04/04/executive-order-no-58-s-2024/))

Non-authoritative guidance:

- NIST, [SP 800-63B-4 Digital Identity Guidelines: Authentication and Authenticator Management](https://pages.nist.gov/800-63-4/sp800-63b.html) (final, August 2025)
- OWASP, [Application Security Verification Standard 5.0.0](https://github.com/OWASP/ASVS/tree/v5.0.0_release/5.0/en) (V6 Authentication, V7 Session Management, V11 Cryptography and Appendix C, V13 Configuration, V16 Security Logging)
