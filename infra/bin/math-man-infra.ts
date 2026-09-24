#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MathManSiteStack } from '../lib/math-man-site-stack';

const app = new cdk.App();

new MathManSiteStack(app, 'MathManSiteStack', {
  // Uses the CLI's default account/region (from your AWS credentials/profile).
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: 'Math Man static site: private S3 bucket served via CloudFront (OAC).',
});

app.synth();
