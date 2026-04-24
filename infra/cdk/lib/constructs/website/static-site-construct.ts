import { Duration } from "aws-cdk-lib";
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

    const redirectFunction =
      props.rootDomain && props.wwwDomain
        ? new cloudfront.Function(this, "CanonicalHostRedirect", {
            code: cloudfront.FunctionCode.fromInline(`
function rewriteVersionedLandingPath(uri) {
  var match = /^\\/(v[234])\\/?$/.exec(uri);
  if (!match) {
    return uri;
  }

  return "/" + match[1] + "/index.html";
}

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

  request.uri = rewriteVersionedLandingPath(request.uri);

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
          : undefined
    });

    new s3deploy.BucketDeployment(this, "DeployLandingPageAssets", {
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ["/*"],
      sources: [s3deploy.Source.asset(path.resolve(props.siteAssetPath))]
    });
  }
}
