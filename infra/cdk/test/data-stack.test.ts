import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { DataStack } from "../lib/stacks/data-stack";

describe("DataStack", () => {
  it("creates a DynamoDB table with TTL and a phone lookup index", () => {
    const app = new cdk.App();
    const stack = new DataStack(app, "TestDataStack", {
      stage: "dev"
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
      TimeToLiveSpecification: {
        AttributeName: "ttl",
        Enabled: true
      },
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: "gsi1"
        })
      ])
    });

    expect(template.toJSON()).toBeDefined();
  });
});
