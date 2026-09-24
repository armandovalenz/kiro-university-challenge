# Math Man — CloudFront deployment (CDK, no pipeline)

Deploys the built Math Man game (`dist/`) to a **private S3 bucket** served through a
**CloudFront** distribution using **Origin Access Control (OAC)**. There is no CI/CD
pipeline: you run `cdk deploy` yourself and it uploads the current build and invalidates
the CloudFront cache.

```
Browser ──HTTPS──> CloudFront ──OAC──> private S3 bucket (dist/)
```

## Prerequisites

1. **Node.js 18+** and **npm**.
2. **AWS credentials** configured for the target account:
   ```bash
   aws configure          # set Access Key, Secret, default region
   aws sts get-caller-identity   # verify
   ```
3. **AWS CDK bootstrap** (once per account/region — creates the assets bucket CDK needs):
   ```bash
   cd infra
   npm install
   npx cdk bootstrap
   ```

## Deploy

Build the game first (from the **repo root**), then deploy (from **infra/**):

```bash
# 1. Build the static site  (repo root)
npm install
npm run build          # produces ./dist

# 2. Deploy the infrastructure  (infra/)
cd infra
npm install            # first time only
npm run deploy         # cdk deploy
```

On success, CDK prints outputs including:

- `DistributionUrl` — the public HTTPS URL for the game.
- `DistributionId` — CloudFront distribution ID.
- `BucketName` — the S3 bucket holding the assets.

Open the `DistributionUrl` in a browser to play. First deploy takes a few minutes while
the CloudFront distribution provisions.

## Redeploying after code changes

```bash
npm run build          # repo root — rebuild dist/
cd infra && npm run deploy   # re-uploads dist/ and invalidates the CDN cache
```

## Useful commands

| Command | What it does |
|---|---|
| `npm run synth` | Synthesize the CloudFormation template (no deploy) |
| `npm run diff` | Show what would change vs. the deployed stack |
| `npm run deploy` | Deploy / update the stack |
| `npm run destroy` | Tear everything down (bucket is emptied and removed) |

## Notes

- The S3 bucket is **private**; only CloudFront can read it (OAC). The build uses Vite's
  `base: './'`, so all asset paths are relative and work behind CloudFront.
- `403`/`404` responses return `index.html` so deep links load the game.
- `removalPolicy: DESTROY` + `autoDeleteObjects` are set so `cdk destroy` fully cleans up.
  This suits a redeployable static site; remove those if you need the bucket to persist.
