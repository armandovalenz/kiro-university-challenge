#!/usr/bin/env bash
#
# deploy.sh — Upload the latest Math Man build to S3 and refresh CloudFront.
#
# Unlike `cdk deploy`, this does NOT run a CloudFormation update. It reads the
# bucket name and distribution ID from the already-deployed MathManSiteStack,
# then:
#   1. syncs ../dist  ->  the private S3 origin bucket (with --delete)
#   2. creates a CloudFront invalidation for /*  (refreshes the CDN cache)
#   3. waits for the invalidation to complete
#
# Use this for fast content-only redeploys. Use `npm run deploy` (CDK) when the
# infrastructure itself changes.
#
# Usage:
#   ./deploy.sh                 # uses stack MathManSiteStack, default profile/region
#   STACK_NAME=MyStack ./deploy.sh
#   AWS_PROFILE=myprofile AWS_REGION=us-east-1 ./deploy.sh
#
set -euo pipefail

# --- Config (override via environment variables) ----------------------------
STACK_NAME="${STACK_NAME:-MathManSiteStack}"

# Region the stack is deployed in. Defaults to us-west-2; override by exporting
# AWS_REGION before running the script.
AWS_REGION="${AWS_REGION:-us-west-2}"

# Resolve paths relative to this script so it works from any working directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="${DIST_DIR:-$SCRIPT_DIR/../dist}"

# Build the AWS CLI profile/region flags only when provided.
AWS_ARGS=()
[[ -n "${AWS_PROFILE:-}" ]] && AWS_ARGS+=(--profile "$AWS_PROFILE")
[[ -n "${AWS_REGION:-}"  ]] && AWS_ARGS+=(--region  "$AWS_REGION")

# --- Preflight checks -------------------------------------------------------
command -v aws >/dev/null 2>&1 || { echo "error: aws CLI not found on PATH." >&2; exit 1; }

if [[ ! -f "$DIST_DIR/index.html" ]]; then
  echo "error: no build found at $DIST_DIR (missing index.html)." >&2
  echo "       run 'npm run build' in the repo root first." >&2
  exit 1
fi

echo "==> Reading stack outputs from '$STACK_NAME'..."
get_output() {
  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" \
    --output text "${AWS_ARGS[@]}"
}

BUCKET_NAME="$(get_output BucketName)"
DISTRIBUTION_ID="$(get_output DistributionId)"

if [[ -z "$BUCKET_NAME" || "$BUCKET_NAME" == "None" ]]; then
  echo "error: could not resolve BucketName from stack '$STACK_NAME'." >&2
  echo "       is the stack deployed? try 'npm run deploy' first." >&2
  exit 1
fi
if [[ -z "$DISTRIBUTION_ID" || "$DISTRIBUTION_ID" == "None" ]]; then
  echo "error: could not resolve DistributionId from stack '$STACK_NAME'." >&2
  exit 1
fi

echo "    Bucket:         $BUCKET_NAME"
echo "    Distribution:   $DISTRIBUTION_ID"
echo "    Source (dist):  $DIST_DIR"

# --- 1. Upload the new version ----------------------------------------------
echo "==> Syncing build to s3://$BUCKET_NAME ..."
aws s3 sync "$DIST_DIR" "s3://$BUCKET_NAME" \
  --delete \
  "${AWS_ARGS[@]}"

# --- 2. Invalidate (refresh) the CloudFront cache ---------------------------
echo "==> Creating CloudFront invalidation for /* ..."
INVALIDATION_ID="$(aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text \
  "${AWS_ARGS[@]}")"

echo "    Invalidation ID: $INVALIDATION_ID"

# --- 3. Wait for the invalidation to finish ---------------------------------
echo "==> Waiting for invalidation to complete (this may take a minute)..."
aws cloudfront wait invalidation-completed \
  --distribution-id "$DISTRIBUTION_ID" \
  --id "$INVALIDATION_ID" \
  "${AWS_ARGS[@]}"

echo "==> Done. New version is live and the CDN cache has been refreshed."
