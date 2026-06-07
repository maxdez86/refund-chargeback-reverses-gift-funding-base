import { Duration, RemovalPolicy, Size } from "aws-cdk-lib";
import path from "node:path";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import { type AppStage } from "@brimax/config";

export interface StaticSiteConstructProps {
  certificate?: acm.ICertificate;
  mediaBucket?: s3.IBucket;
  rootDomain?: string;
  siteAssetPath: string;
  stage: AppStage;
  wwwDomain?: string;
}

export class StaticSiteConstruct extends Construct {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: StaticSiteConstructProps) {
    super(scope, id);

    this.bucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true
    });

    // CloudFront standard (legacy) access logs. Legacy log delivery writes via
    // ACL, so the bucket must keep ACLs enabled (BUCKET_OWNER_PREFERRED, not the
    // default BUCKET_OWNER_ENFORCED). Logs expire after 90 days; prod retains the
    // bucket on teardown, non-prod is disposable.
    const logBucket = new s3.Bucket(this, "SiteLogBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      lifecycleRules: [{ expiration: Duration.days(90) }],
      removalPolicy: props.stage === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: props.stage !== "prod"
    });

    const mediaPrefixStripFunction = props.mediaBucket
      ? new cloudfront.Function(this, "MediaPrefixStrip", {
          code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  if (request.uri.indexOf("/media/") === 0) {
    request.uri = request.uri.substring(6);
  }
  return request;
}
`)
        })
      : undefined;

    const redirectFunction =
      props.rootDomain && props.wwwDomain
        ? new cloudfront.Function(this, "CanonicalHostRedirect", {
            code: cloudfront.FunctionCode.fromInline(`
function serializeQuerystring(querystring) {
  var parts = [];
  for (var key in querystring) {
    if (!Object.prototype.hasOwnProperty.call(querystring, key)) {
      continue;
    }
    var entry = querystring[key];
    if (entry && entry.multiValue) {
      for (var i = 0; i < entry.multiValue.length; i++) {
        var item = entry.multiValue[i];
        parts.push(item.value ? key + "=" + item.value : key);
      }
    } else if (entry) {
      parts.push(entry.value ? key + "=" + entry.value : key);
    }
  }
  return parts.length > 0 ? "?" + parts.join("&") : "";
}

function handler(event) {
  var request = event.request;
  var host = request.headers.host && request.headers.host.value;

  if (host === "${props.wwwDomain}") {
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: {
        location: {
          value: "https://${props.rootDomain}" + request.uri + serializeQuerystring(request.querystring || {})
        }
      }
    };
  }

  if (host !== "${props.rootDomain}") {
    return {
      statusCode: 403,
      statusDescription: "Forbidden",
      headers: {
        "content-type": {
          value: "text/plain; charset=utf-8"
        }
      },
      body: "Forbidden"
    };
  }

  return request;
}
`)
          })
        : undefined;

    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
      this,
      "SiteSecurityHeaders",
      {
        securityHeadersBehavior: {
          contentTypeOptions: {
            override: true
          },
          frameOptions: {
            frameOption: cloudfront.HeadersFrameOption.DENY,
            override: true
          },
          referrerPolicy: {
            override: true,
            referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN
          },
          strictTransportSecurity: {
            accessControlMaxAge: Duration.days(365),
            includeSubdomains: true,
            override: true,
            preload: false
          }
        }
      }
    );

    this.distribution = new cloudfront.Distribution(this, "SiteDistribution", {
      additionalBehaviors: props.mediaBucket
        ? {
            "/media/*": {
              cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
              functionAssociations: mediaPrefixStripFunction
                ? [
                    {
                      eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
                      function: mediaPrefixStripFunction
                    }
                  ]
                : undefined,
              origin: origins.S3BucketOrigin.withOriginAccessControl(props.mediaBucket),
              responseHeadersPolicy,
              viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
            }
          }
        : undefined,
      certificate: props.certificate,
      defaultBehavior: {
        functionAssociations: redirectFunction
          ? [
              {
                eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
                function: redirectFunction
              }
            ]
          : undefined,
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        responseHeadersPolicy,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      },
      defaultRootObject: "index.html",
      domainNames:
        props.certificate && props.rootDomain && props.wwwDomain
          ? [props.rootDomain, props.wwwDomain]
          : undefined,
      enableLogging: true,
      logBucket,
      logFilePrefix: "cloudfront/",
      // Explicit: South America (São Paulo) edges exist only in PriceClass_All.
      // The audience is in Brazil, so anything lower would add latency; at
      // wedding-scale traffic the cost difference is negligible.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL
    });

    new s3deploy.BucketDeployment(this, "DeployLandingPageAssets", {
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ["/*"],
      ephemeralStorageSize: Size.gibibytes(1),
      memoryLimit: 1024,
      sources: [s3deploy.Source.asset(path.resolve(props.siteAssetPath))]
    });
  }
}
