import path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { EdgeStack } from "../lib/stacks/edge-stack";
import { DEFAULT_STAGE, resourceName, resolveStage } from "@brimax/config";

const fixtureSiteAssetPath = path.resolve(__dirname, "./fixtures/site");

describe("EdgeStack", () => {
  it("creates a private website bucket and CloudFront distribution", { timeout: 10000 }, () => {
    const app = new cdk.App();
    const stack = new EdgeStack(app, "TestEdgeStack", {
      siteAssetPath: fixtureSiteAssetPath,
      stage: "dev"
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::S3::Bucket", 2);
    template.resourceCountIs("AWS::CloudFront::Distribution", 1);

    expect(template.toJSON()).toBeDefined();
  });

  it("defaults stage resolution to production and keeps stack names bare", () => {
    expect(resolveStage(undefined)).toBe(DEFAULT_STAGE);

    const app = new cdk.App();
    const stack = new EdgeStack(app, resourceName("BrimaxEdgeStack", resolveStage(undefined)), {
      siteAssetPath: fixtureSiteAssetPath,
      stage: resolveStage(undefined)
    });

    expect(stack.stackName).toBe("BrimaxEdgeStack");
  });

  it("attaches apex and www aliases when a certificate is provided", () => {
    const app = new cdk.App();
    const stack = new EdgeStack(app, "TestEdgeCustomDomainStack", {
      certificate: acm.Certificate.fromCertificateArn(
        app,
        "ImportedCertificate",
        "arn:aws:acm:us-east-1:123456789012:certificate/test"
      ),
      rootDomain: "brimax.life",
      siteAssetPath: fixtureSiteAssetPath,
      stage: "prod",
      wwwDomain: "www.brimax.life"
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Aliases: ["brimax.life", "www.brimax.life"]
      })
    });

    template.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionCode: Match.stringLikeRegexp('host === "www\\.brimax\\.life"')
    });
    template.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionCode: Match.stringLikeRegexp('host !== "brimax\\.life"')
    });
    template.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionCode: Match.stringLikeRegexp('statusCode: 403')
    });
    const functionResources = template.findResources("AWS::CloudFront::Function");
    const functionCode = Object.values(functionResources)[0]?.Properties?.FunctionCode as string;

    expect(functionCode).not.toContain("rewriteVersionedLandingPath");
    expect(functionCode).not.toContain("v[234]");
    expect(functionCode).not.toContain("/index.html");
  });

  it("configures the bucket deployment custom resource with higher Lambda resources", () => {
    const app = new cdk.App();
    const stack = new EdgeStack(app, "TestEdgeBucketDeploymentStack", {
      siteAssetPath: fixtureSiteAssetPath,
      stage: "prod"
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties("Custom::CDKBucketDeployment", {
      ServiceToken: Match.anyValue()
    });

    template.hasResourceProperties("AWS::Lambda::Function", {
      EphemeralStorage: {
        Size: 1024
      },
      MemorySize: 1024
    });
  });

  it("attaches a response headers policy with the baseline security headers", () => {
    const app = new cdk.App();
    const stack = new EdgeStack(app, "TestEdgeSecurityHeadersStack", {
      siteAssetPath: fixtureSiteAssetPath,
      stage: "prod"
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          ContentTypeOptions: Match.objectLike({
            Override: true
          }),
          FrameOptions: Match.objectLike({
            FrameOption: "DENY",
            Override: true
          }),
          ReferrerPolicy: Match.objectLike({
            Override: true,
            ReferrerPolicy: "strict-origin-when-cross-origin"
          }),
          StrictTransportSecurity: Match.objectLike({
            AccessControlMaxAgeSec: 31536000,
            IncludeSubdomains: true,
            Override: true,
            Preload: false
          })
        })
      })
    });

    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          ResponseHeadersPolicyId: Match.anyValue()
        })
      })
    });
  });
});
