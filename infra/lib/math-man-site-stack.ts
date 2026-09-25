import * as path from 'path';
import * as fs from 'fs';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';

/**
 * Deploys the Math Man static build (Vite `dist/`) as a private S3 bucket
 * served through a CloudFront distribution using Origin Access Control (OAC).
 *
 * Security posture:
 *   - Origin bucket is private (BLOCK_ALL) and read only by CloudFront via OAC.
 *   - A `ResponseHeadersPolicy` adds CSP, HSTS, X-Content-Type-Options,
 *     X-Frame-Options, Referrer-Policy, and Permissions-Policy to every response.
 *   - Access logging is enabled to a dedicated private, 90-day-retention bucket.
 *   - TLS 1.2_2021 minimum, viewer requests redirected to HTTPS.
 *
 * There is no CI/CD pipeline: running `cdk deploy` uploads the current
 * contents of `../dist` and invalidates the CloudFront cache.
 */
export class MathManSiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Absolute path to the game's production build output (repo-root/dist).
    const distPath = path.join(__dirname, '..', '..', 'dist');

    // Fail early with a helpful message if the build hasn't been produced yet.
    if (!fs.existsSync(path.join(distPath, 'index.html'))) {
      throw new Error(
        `No build found at ${distPath}. Run "npm run build" in the project root before deploying.`,
      );
    }

    // Private bucket to hold the static assets. No public access; CloudFront
    // reads it via OAC. Objects are encrypted with S3-managed keys.
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      enforceSSL: true,
      versioned: false,
      // This is a redeployable static site; allow teardown to clean up.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Dedicated, private log bucket for CloudFront access logs (audit trail).
    // CloudFront's standard (non-real-time) logging delivers logs via an ACL
    // grant, so the bucket must permit ACLs — ObjectOwnership.BUCKET_OWNER_
    // PREFERRED keeps the account as owner while allowing the log-delivery ACL.
    const logBucket = new s3.Bucket(this, 'LogBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      // Expire logs after 90 days so the bucket doesn't grow unbounded.
      lifecycleRules: [{ expiration: cdk.Duration.days(90) }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Security response headers applied to every viewer response (defense in
    // depth): CSP, HSTS, nosniff, clickjacking + referrer + permissions policy.
    // NOTE: the game uses an inline <style> block and inline element styles, so
    // the CSP must allow 'unsafe-inline' for styles. Everything else is locked
    // to same-origin; images/media also allow data: URIs used at runtime.
    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      comment: 'Math Man security headers',
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "media-src 'self'",
            "connect-src 'self'",
            "font-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
          ].join('; '),
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          preload: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: {
          frameOption: cloudfront.HeadersFrameOption.DENY,
          override: true,
        },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
      customHeadersBehavior: {
        customHeaders: [
          {
            header: 'Permissions-Policy',
            value: 'geolocation=(), microphone=(), camera=(), interest-cohort=()',
            override: true,
          },
        ],
      },
    });

    // CloudFront distribution. The S3 origin uses Origin Access Control so the
    // bucket stays private and only CloudFront can read it.
    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      comment: 'Math Man static site',
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      // Access logging to the dedicated private log bucket (audit trail).
      enableLogging: true,
      logBucket,
      logFilePrefix: 'cloudfront/',
      logIncludesCookies: false,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        compress: true,
      },
      // No SPA-style error rewrites: Math Man is a single index.html, not a
      // client-side-routed app. Letting genuine 403/404s surface preserves
      // meaningful monitoring signals (missing assets, S3 AccessDenied, OAC
      // regressions) instead of masking them behind a 200.
    });

    // Upload the build to the bucket and invalidate the cache on each deploy.
    new s3deploy.BucketDeployment(this, 'DeployMathMan', {
      sources: [s3deploy.Source.asset(distPath)],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      prune: true,
    });

    // Handy outputs after deploy.
    new cdk.CfnOutput(this, 'DistributionUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Public URL for the Math Man game.',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront distribution ID (for manual cache invalidation).',
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: siteBucket.bucketName,
      description: 'S3 bucket holding the static assets.',
    });

    new cdk.CfnOutput(this, 'LogBucketName', {
      value: logBucket.bucketName,
      description: 'S3 bucket holding CloudFront access logs.',
    });
  }
}
