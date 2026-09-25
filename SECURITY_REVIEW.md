# Security Review — Math Man

> **Evidence of Kiro Web usage.** This document records a security vulnerability
> review of the `armandovalenz/kiro-university-challenge` repository (the
> **Math Man** educational maze game), performed in **Kiro Web (Vibe mode)**.
> It captures the scope, methodology, findings, and the GitHub issues that were
> filed as a result.

- **Date:** September 25, 2026
- **Reviewer:** Kiro (AI software engineer) — Kiro Web, Vibe mode
- **Repository:** [`armandovalenz/kiro-university-challenge`](https://github.com/armandovalenz/kiro-university-challenge)
- **Branch reviewed:** `main`
- **Task:** Perform a security vulnerabilities review of the repository and open GitHub issues for the findings.

---

## 1. Scope

The repository contains two distinct components, both reviewed:

| Component | Path | Description |
|-----------|------|-------------|
| **Game (frontend)** | `src/`, `index.html`, `public/`, `vite.config.js` | Client-side Phaser 3 + Vite arcade game. **No backend, no login.** All state persisted in `localStorage`. |
| **Infrastructure** | `infra/` | AWS CDK app deploying the static build to a private S3 bucket served via CloudFront (Origin Access Control). No CI/CD pipeline. |

---

## 2. Methodology

The review combined manual code reading with automated tooling, all driven from the Kiro Web session:

1. **Repository mapping** — enumerated the file tree and read the entry points (`index.html`, `src/main.js`, `package.json`, `vite.config.js`) and the infra stack.
2. **Source audit for injection / XSS sinks** — searched the whole `src/` tree for dangerous patterns:
   - `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`
   - `eval(`, `new Function`
   - `localStorage`, `.href =`, `window.open`, `postMessage`, `fetch(`
3. **Data-handling review** — read the modules that process dynamic/persisted data:
   - `src/ui/QuizModal.js`, `src/ui/LessonModal.js` (DOM rendering of question/lesson content)
   - `src/systems/Storage.js` (localStorage read/write + validation)
   - `src/systems/QuestionBank.js` (JSON question-bank loading + validation)
4. **Secret scanning** — grepped for AWS keys, tokens, passwords, private-key headers; verified `.env*` is gitignored.
5. **Dependency audit** — ran `npm audit` in both the root and `infra/` projects (with structured JSON output for exact ranges/severities).
6. **Infrastructure-as-Code review** — read `infra/lib/math-man-site-stack.ts`, `infra/bin/math-man-infra.ts`, and `infra/cdk.json` for CloudFront/S3 misconfigurations (headers, logging, access controls, error handling).

### Commands used (representative)

```bash
# Dependency audits (NODE_OPTIONS unset to bypass a sandbox preload shim)
npm audit                     # root — 0 vulnerabilities
cd infra && npm audit         # infra — 7 vulnerabilities (4 high, 3 moderate)

# Source scan for XSS / injection sinks (no matches in src/)
grep -rInE "innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|document\.write" src/

# Secret scan (no matches)
grep -rInE "(AKIA[0-9A-Z]{16}|secret|password|api[_-]?key|token|private[_-]?key)" src infra
```

---

## 3. Findings summary

| # | Finding | Component | Severity | GitHub Issue |
|---|---------|-----------|----------|--------------|
| 1 | High/moderate vulnerabilities in CDK dependencies (7 total) | `infra/` | **High** | [#1](https://github.com/armandovalenz/kiro-university-challenge/issues/1) |
| 2 | CloudFront serves no HTTP security response headers | `infra/` | **Medium** | [#2](https://github.com/armandovalenz/kiro-university-challenge/issues/2) |
| 3 | No access logging on CloudFront or S3 origin bucket | `infra/` | **Low** | [#3](https://github.com/armandovalenz/kiro-university-challenge/issues/3) |
| 4 | CloudFront rewrites 403/404 → 200 index.html (masks errors) | `infra/` | **Low** | [#4](https://github.com/armandovalenz/kiro-university-challenge/issues/4) |

**Headline result:** The shipped game itself had **no runtime security vulnerabilities** identified. All findings are concentrated in the deploy tooling (dependency CVEs) and infrastructure hardening.

---

## 4. What was reviewed and found clean ✅

The frontend game code demonstrated solid security hygiene:

- **No XSS sinks.** Both DOM modals (`QuizModal.js`, `LessonModal.js`) render all dynamic content — question prompts, choices, explanations, lesson text — exclusively via `textContent`. There is no `innerHTML`/`insertAdjacentHTML` anywhere, so injected markup in question/lesson data cannot execute.
- **No dangerous evaluation.** No `eval`, `new Function`, or `document.write` in the codebase.
- **Hardened persistence.** `Storage.js` guards every `localStorage` read with `JSON.parse` in a `try/catch`, then **normalizes** each field (type coercion, non-negative integer clamps, grade allow-listing, `correct ≤ answered` invariant) before use. Malformed on-disk data cannot corrupt state or throw — it degrades to safe defaults / in-memory fallback.
- **Validated question bank.** `QuestionBank.js` validates every record (required non-empty string fields, allowed grade, `answer ∈ choices`) and drops invalid ones, with a built-in fallback set if the JSON is missing/malformed.
- **No secrets committed.** No API keys, tokens, or credentials found; `.env*` files are correctly gitignored.
- **Infra already does several things right:** private S3 bucket with `BLOCK_ALL` public access, Origin Access Control (OAC), `minimumProtocolVersion` TLS 1.2_2021, `enforceSSL`, and `REDIRECT_TO_HTTPS`.

---

## 5. Detailed findings

### Finding 1 — Vulnerable CDK dependencies (High) · Issue [#1](https://github.com/armandovalenz/kiro-university-challenge/issues/1)

`npm audit` in `infra/` reports **7 known vulnerabilities (4 high, 3 moderate)**, all transitive dependencies of `aws-cdk-lib@2.174.1` / `aws-cdk@2.174.1`:

| Package | Severity | Vulnerable range | Advisory |
|---------|----------|------------------|----------|
| minimatch | high | `<=3.1.3` | ReDoS via repeated wildcards / GLOBSTAR backtracking |
| fast-uri | high | `3.0.0 - 3.1.5` | SSRF & host confusion via malformed URI / IPv6 normalization |
| brace-expansion | high | `<=1.1.17` | ReDoS |
| aws-cdk-lib | high | `<=2.259.0` | pulls in the vulnerable transitive deps above |
| ajv | moderate | `7.0.0-alpha.0 - 8.17.1` | validation/prototype issue |
| aws-cdk (CLI) | moderate | `2.172.0 - 2.178.1` | — |
| yaml | moderate | `1.0.0 - 1.10.2` | stack overflow via deeply nested collections |

- **Impact:** These execute at **build/deploy time** (CDK synth/deploy), not in the shipped game, so runtime exposure is low — but ReDoS/SSRF in build tooling is a real supply-chain risk, especially in CI.
- **Recommendation:** Bump `aws-cdk-lib` and `aws-cdk` to `>=2.270.0` (`npm audit fix --force`, then verify `cdk synth`/`cdk diff`); add automated dependency scanning (Dependabot or `npm audit` in CI).

### Finding 2 — Missing HTTP security headers (Medium) · Issue [#2](https://github.com/armandovalenz/kiro-university-challenge/issues/2)

The CloudFront distribution in `infra/lib/math-man-site-stack.ts` attaches **no `ResponseHeadersPolicy`**, so responses lack `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, and `Permissions-Policy`.

- **Impact:** Limited blast radius (no login/backend), but a CSP + `nosniff` + HSTS are cheap defense-in-depth that reduce the impact of any future content-injection bug. Commonly flagged by scanners (e.g. Mozilla Observatory).
- **Recommendation:** Add a `cloudfront.ResponseHeadersPolicy` with `securityHeadersBehavior` to `defaultBehavior`. Note the game uses inline styles, so `style-src 'unsafe-inline'` is needed (or refactor to external CSS); validate the CSP against the running build before enforcing.

### Finding 3 — No access logging (Low) · Issue [#3](https://github.com/armandovalenz/kiro-university-challenge/issues/3)

Neither the CloudFront distribution nor the origin S3 bucket enables access logging — no audit trail.

- **Impact:** No forensic data for abuse investigation, traffic anomalies, or attempts to reach the private bucket directly. Audit-trail gaps are a routine baseline finding (CIS AWS Foundations, Well-Architected Security pillar). Low severity for a static, no-PII game, but inexpensive to add.
- **Recommendation:** Enable CloudFront access logging to a dedicated private log bucket (`enableLogging` / `logBucket`); optionally enable S3 server access logging; set a retention lifecycle.

### Finding 4 — 403/404 rewritten to 200 (Low / hardening) · Issue [#4](https://github.com/armandovalenz/kiro-university-challenge/issues/4)

The distribution maps `403` and `404` origin responses to `200` with `/index.html` (SPA-style rewrite).

- **Impact:** Math Man is **not** a client-side-routed SPA — it's a single `index.html` bootstrapping Phaser — so the blanket rewrite isn't needed and it masks real failures (missing assets, S3 `AccessDenied`, OAC/permission regressions all silently return a 200). This hurts monitoring and undermines the value of access logging.
- **Recommendation:** Remove the `errorResponses` rewrites (or return real status codes); if a custom error page is desired, serve it with the correct `403`/`404` status, not `200`.

---

## 6. GitHub issues created

All findings were filed as issues on the repository via the GitHub REST API during the Kiro Web session:

- **[#1 — [Security] High/moderate vulnerabilities in infra/ (CDK) dependencies (7 total)](https://github.com/armandovalenz/kiro-university-challenge/issues/1)**
- **[#2 — [Security] CloudFront distribution serves no HTTP security response headers](https://github.com/armandovalenz/kiro-university-challenge/issues/2)**
- **[#3 — [Security] No access logging on CloudFront distribution or S3 origin bucket](https://github.com/armandovalenz/kiro-university-challenge/issues/3)**
- **[#4 — [Security/Hardening] CloudFront rewrites 403/404 to 200 index.html, masking error signals](https://github.com/armandovalenz/kiro-university-challenge/issues/4)**

Each issue includes an impact analysis, exact file location, reproduction/remediation steps, and code snippets.

---

## 7. Recommended remediation order

1. **Issue #1** — patch the vulnerable CDK dependencies (highest severity, quick win via version bump).
2. **Issue #2** — add the CloudFront `ResponseHeadersPolicy` (medium, meaningful defense-in-depth).
3. **Issue #3** — enable access logging (low, enables detection/forensics).
4. **Issue #4** — fix the error-response mapping (low, improves signal for #3 and monitoring).

---

*Generated with Kiro Web (Vibe mode) as part of an AI-assisted security review.*
