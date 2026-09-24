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

    // CloudFront distribution. The S3 origin uses Origin Access Control so the
    // bucket stays private and only CloudFront can read it.
    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      comment: 'Math Man static site',
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      // Serve index.html for unknown routes (single-page-app friendly).
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
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
  }
}
