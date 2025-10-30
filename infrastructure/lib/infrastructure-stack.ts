import * as cdk from 'aws-cdk-lib/core';
import {CfnOutput, Duration, RemovalPolicy} from 'aws-cdk-lib/core';
import {Construct} from 'constructs';
import {ARecord, HostedZone, RecordTarget} from "aws-cdk-lib/aws-route53";
import {BlockPublicAccess, Bucket, BucketAccessControl} from "aws-cdk-lib/aws-s3";
import {AllowedMethods, Distribution, SecurityPolicyProtocol, ViewerProtocolPolicy} from "aws-cdk-lib/aws-cloudfront";
import {S3StaticWebsiteOrigin} from "aws-cdk-lib/aws-cloudfront-origins";
import {BucketDeployment, Source} from "aws-cdk-lib/aws-s3-deployment";
import * as path from "node:path";
import {DnsValidatedCertificate} from "aws-cdk-lib/aws-certificatemanager";
import {CloudFrontTarget} from "aws-cdk-lib/aws-route53-targets";


export class InfrastructureStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);
        const domainName = 'code-adjacent.com';
        const siteDomain = 'www' + '.' + domainName;
        const bucketName = 'code-adjacent-dumbelf';
        const hostedZone = HostedZone.fromLookup(this, 'Z04285995NLANJ9487TN', {
            domainName,
        });
        const certificate = new DnsValidatedCertificate(this, 'SiteCertificate', {
            domainName: domainName,
            subjectAlternativeNames: ['*.' + domainName],
            hostedZone,
            region: 'us-east-1', // Cloudfront only checks this region for certificates
        });
        // 2.1 The removal policy for the certificate can be set to 'Retain' or 'Destroy'
        certificate.applyRemovalPolicy(RemovalPolicy.DESTROY)
        new CfnOutput(this, 'Certificate', {value: certificate.certificateArn});

        // 3. Create an S3 bucket to store content, and set the removal policy to either 'Retain' or 'Destroy'
        // Please be aware that all content stored in the S3 bucket is publicly available.
        const siteBucket = new Bucket(this, 'SiteBucket', {
            bucketName,
            publicReadAccess: true,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            blockPublicAccess: BlockPublicAccess.BLOCK_ACLS_ONLY,
            accessControl: BucketAccessControl.BUCKET_OWNER_FULL_CONTROL,
            websiteIndexDocument: 'index.html',
            websiteErrorDocument: 'error/index.html'
        })
        new CfnOutput(this, 'Bucket', {value: siteBucket.bucketName});

        // 4. Deploy CloudFront distribution
        const distribution = new Distribution(this, 'SiteDistribution', {
            certificate: certificate,
            defaultRootObject: "index.html",
            domainNames: [siteDomain, domainName],
            minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
            errorResponses: [
                {
                    httpStatus: 404,
                    responseHttpStatus: 404,
                    responsePagePath: '/error/index.html',
                    ttl: Duration.minutes(30),
                }
            ],
            defaultBehavior: {
                origin: new S3StaticWebsiteOrigin(siteBucket),
                compress: true,
                allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            }
        });

        new CfnOutput(this, 'DistributionId', {value: distribution.distributionId});

        // 5. Create a Route 53 alias record for the CloudFront distribution
        //5.1  Add an 'A' record to Route 53 for 'www.example.com'
        new ARecord(this, 'WWWSiteAliasRecord', {
            zone: hostedZone,
            recordName: siteDomain,
            target: RecordTarget.fromAlias(new CloudFrontTarget(distribution))
        });
        //5.2 Add an 'A' record to Route 53 for 'example.com'
        new ARecord(this, 'SiteAliasRecord', {
            zone: hostedZone,
            recordName: domainName,
            target: RecordTarget.fromAlias(new CloudFrontTarget(distribution))
        });

        // // Deploy the React app to the S3 bucket
        new BucketDeployment(this, 'DeployReactApp', {
            sources: [Source.asset(path.join(__dirname, '..', '..', 'frontend-react', 'dist'))],
            destinationBucket: siteBucket,
            distribution,  // Invalidate CloudFront cache on new deploy
            distributionPaths: ['/*'],
        });
    }
}
