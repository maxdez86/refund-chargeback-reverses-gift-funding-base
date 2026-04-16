import path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { EdgeStack } from "../lib/stacks/edge-stack";
import { DEFAULT_STAGE, resourceName, resolveStage } from "@brimax/config";

const fixtureSiteAssetPath = path.resolve(__dirname, "./fixtures/site");

describe("EdgeStack", () => {
  it("creates a private website bucket and CloudFront distribution", () => {
    const app = new cdk.App();
    const stack = new EdgeStack(app, "TestEdgeStack", {
      siteAssetPath: fixtureSiteAssetPath,
      stage: "dev"
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::S3::Bucket", 1);
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
  });
});
