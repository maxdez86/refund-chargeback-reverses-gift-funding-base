import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { EdgeStack } from "../lib/stacks/edge-stack";

describe("EdgeStack", () => {
  it("creates a private website bucket and CloudFront distribution", () => {
    const app = new cdk.App();
    const stack = new EdgeStack(app, "TestEdgeStack", {
      stage: "dev"
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::S3::Bucket", 1);
    template.resourceCountIs("AWS::CloudFront::Distribution", 1);

    expect(template.toJSON()).toBeDefined();
  });
});
