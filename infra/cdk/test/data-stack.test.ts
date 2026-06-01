import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { DataStack } from "../lib/stacks/data-stack";
import { applyCostAllocationTags } from "./support/tags";

describe("DataStack", () => {
  it("creates a DynamoDB table with TTL and the Asaas payment lookup index", () => {
    const app = new cdk.App();
    applyCostAllocationTags(app, "dev");
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
      ]),
      Tags: Match.arrayWith([
        { Key: "project", Value: "brimax-life" },
        { Key: "stage", Value: "dev" }
      ])
    });

    expect(template.toJSON()).toBeDefined();
  });

  it("keeps production table names bare", () => {
    const app = new cdk.App();
    applyCostAllocationTags(app, "prod");
    const stack = new DataStack(app, "ProdDataStack", {
      stage: "prod"
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "brimax-wedding"
    });
  });

  it("adds a dev prefix to development table names", () => {
    const app = new cdk.App();
    applyCostAllocationTags(app, "dev");
    const stack = new DataStack(app, "DevDataStack", {
      stage: "dev"
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "dev-brimax-wedding"
    });
  });
});
