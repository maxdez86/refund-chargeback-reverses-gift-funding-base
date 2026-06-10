import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { GithubOidcStack } from "../lib/stacks/github-oidc-stack";
import { applyCostAllocationTags } from "./support/tags";

describe("GithubOidcStack", () => {
  it("creates a shared GitHub provider and both environment-scoped deploy roles", () => {
    const app = new cdk.App();
    applyCostAllocationTags(app, "prod");
    const stack = new GithubOidcStack(app, "BrimaxGithubOidcStack", {
      env: { account: "183286346090", region: "us-east-1" },
      githubRepository: "maxdez86/brimax-life",
      stageConfigs: {
        dev: {
          lockTableName: "dev-lock-table",
          stateBucketName: "dev-state-bucket"
        },
        prod: {
          lockTableName: "prod-lock-table",
          stateBucketName: "prod-state-bucket"
        }
      }
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs("Custom::AWSCDKOpenIdConnectProvider", 1);

    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "brimax-github-actions-dev-deploy",
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: Match.objectLike({
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:repository": "maxdez86/brimax-life",
                "token.actions.githubusercontent.com:sub":
                  "repo:maxdez86/brimax-life:environment:dev"
              })
            }
          })
        ])
      }
    });

    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "brimax-github-actions-prod-deploy",
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: Match.objectLike({
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:repository": "maxdez86/brimax-life",
                "token.actions.githubusercontent.com:sub":
                  "repo:maxdez86/brimax-life:environment:prod"
              })
            }
          })
        ])
      }
    });

    const policies = template.findResources("AWS::IAM::Policy");
    const deployPolicies = Object.values(policies).filter((policy) => {
      const roles = policy.Properties?.Roles;
      return Array.isArray(roles) && roles.length === 1;
    });

    const devPolicy = deployPolicies.find((policy) =>
      JSON.stringify(policy.Properties?.Roles?.[0]).includes("GithubActionsDevDeployRole")
    );
    const prodPolicy = deployPolicies.find((policy) =>
      JSON.stringify(policy.Properties?.Roles?.[0]).includes("GithubActionsDeployRole")
    );

    expect(devPolicy).toBeDefined();
    expect(prodPolicy).toBeDefined();

    const devStatements = devPolicy?.Properties?.PolicyDocument?.Statement as Array<Record<string, unknown>>;
    const prodStatements = prodPolicy?.Properties?.PolicyDocument?.Statement as Array<Record<string, unknown>>;
    const devReadStage = devStatements.find((statement) => statement.Sid === "ReadStageCloudFormation");
    const prodReadStage = prodStatements.find((statement) => statement.Sid === "ReadStageCloudFormation");
    const devBucketAccess = devStatements.find((statement) => statement.Sid === "OpenTofuStateBucketAccess");
    const prodBucketAccess = prodStatements.find((statement) => statement.Sid === "OpenTofuStateBucketAccess");
    const devLockAccess = devStatements.find((statement) => statement.Sid === "OpenTofuLockTableAccess");
    const prodLockAccess = prodStatements.find((statement) => statement.Sid === "OpenTofuLockTableAccess");
    const devDataAccess = devStatements.find((statement) => statement.Sid === "DevDataTableAccess");
    const prodDataAccess = prodStatements.find((statement) => statement.Sid === "DevDataTableAccess");

    expect(devReadStage?.Resource).toEqual(
      expect.arrayContaining([
        "arn:aws:cloudformation:us-east-1:183286346090:stack/dev-*",
        "arn:aws:cloudformation:us-east-1:183286346090:stack/CDKToolkit/*"
      ])
    );
    expect(prodReadStage?.Resource).toEqual(
      expect.arrayContaining([
        "arn:aws:cloudformation:us-east-1:183286346090:stack/Brimax*",
        "arn:aws:cloudformation:us-east-1:183286346090:stack/CDKToolkit/*"
      ])
    );
    expect(devDataAccess?.Resource).toEqual(
      expect.arrayContaining([
        "arn:aws:dynamodb:us-east-1:183286346090:table/dev-*",
        "arn:aws:dynamodb:us-east-1:183286346090:table/dev-*/index/*"
      ])
    );
    expect(prodDataAccess).toBeUndefined();
    expect(devBucketAccess?.Resource).toBe("arn:aws:s3:::dev-state-bucket");
    expect(prodBucketAccess?.Resource).toBe("arn:aws:s3:::prod-state-bucket");
    expect(devLockAccess?.Resource).toBe("arn:aws:dynamodb:us-east-1:183286346090:table/dev-lock-table");
    expect(prodLockAccess?.Resource).toBe(
      "arn:aws:dynamodb:us-east-1:183286346090:table/prod-lock-table"
    );

    template.hasOutput("GithubOidcProviderArn", {});
    template.hasOutput("GithubActionsDevDeployRoleArn", {});
    template.hasOutput("GithubActionsProdDeployRoleArn", {});
    template.hasOutput("GithubActionsDevDeployRoleSecretName", {
      Value: "AWS_ROLE_TO_ASSUME_DEV"
    });
    template.hasOutput("GithubActionsProdDeployRoleSecretName", {
      Value: "AWS_ROLE_TO_ASSUME_PROD"
    });
    template.hasOutput("GithubActionsDevEnvironmentName", {
      Value: "dev"
    });
    template.hasOutput("GithubActionsProdEnvironmentName", {
      Value: "prod"
    });

    expect(template.toJSON()).toBeDefined();
  });

  it("always manages the GitHub OIDC provider in the shared stack", () => {
    const app = new cdk.App();
    applyCostAllocationTags(app, "prod");
    const stack = new GithubOidcStack(app, "ManagedProviderStack", {
      env: { account: "183286346090", region: "us-east-1" },
      githubRepository: "maxdez86/brimax-life",
      stageConfigs: {
        dev: {
          lockTableName: "dev-lock-table",
          stateBucketName: "dev-state-bucket"
        },
        prod: {
          lockTableName: "prod-lock-table",
          stateBucketName: "prod-state-bucket"
        }
      }
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs("Custom::AWSCDKOpenIdConnectProvider", 1);
    template.hasOutput("GithubOidcProviderArn", {});
  });
});
