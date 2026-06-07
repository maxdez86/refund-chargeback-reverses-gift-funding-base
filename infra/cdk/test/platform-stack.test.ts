import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { PlatformStack } from "../lib/stacks/platform-stack";
import { applyCostAllocationTags } from "./support/tags";

describe("PlatformStack", () => {
  it("creates the OpenTofu backend bucket and lock table", () => {
    const app = new cdk.App();
    applyCostAllocationTags(app, "prod");
    const stack = new PlatformStack(app, "TestPlatformStack", {
      stage: "prod"
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::S3::Bucket", 1);
    template.resourceCountIs("AWS::DynamoDB::Table", 1);

    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: "AES256"
            }
          }
        ]
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true
      },
      VersioningConfiguration: {
        Status: "Enabled"
      },
      Tags: Match.arrayWith([
        { Key: "project", Value: "brimax-life" },
        { Key: "stage", Value: "prod" }
      ])
    });

    template.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true
      },
      Tags: Match.arrayWith([
        { Key: "project", Value: "brimax-life" },
        { Key: "stage", Value: "prod" }
      ])
    });

    expect(template.toJSON()).toBeDefined();
  });

  it("exposes backend outputs for the OpenTofu init scripts", () => {
    const app = new cdk.App();
    applyCostAllocationTags(app, "prod");
    const stack = new PlatformStack(app, "TestPlatformOutputs", {
      stage: "prod"
    });
    const template = Template.fromStack(stack);

    template.hasOutput("TofuStateBucketName", {});
    template.hasOutput("TofuLockTableName", {});
    template.hasOutput("TofuBackendRegion", {});
  });
});
