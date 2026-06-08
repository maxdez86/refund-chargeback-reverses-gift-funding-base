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
                "token.actions.githubusercontent.com:ref": "refs/heads/dev",
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
                "token.actions.githubusercontent.com:ref": "refs/heads/prod",
                "token.actions.githubusercontent.com:sub":
                  "repo:maxdez86/brimax-life:environment:prod"
              })
            }
          })
        ])
      }
    });

    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: "ReadStageCloudFormation",
            Action: Match.arrayWith([
              "cloudformation:DescribeStacks",
              "cloudformation:GetTemplate"
            ]),
            Resource: Match.arrayWith([
              "arn:aws:cloudformation:us-east-1:183286346090:stack/CDKToolkit/*",
              "arn:aws:cloudformation:us-east-1:183286346090:stack/BrimaxPlatformStack/*",
              "arn:aws:cloudformation:us-east-1:183286346090:stack/BrimaxCertificateStack/*",
              "arn:aws:cloudformation:us-east-1:183286346090:stack/BrimaxEdgeStack/*",
              "arn:aws:cloudformation:us-east-1:183286346090:stack/BrimaxAppStack/*"
            ])
          })
        ])
      }
    });

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
    template.hasOutput("ProdPromotionValidationRoleArn", {});
    template.hasOutput("ProdPromotionValidationRoleSecretName", {
      Value: "AWS_ROLE_TO_ASSUME_DEV_VALIDATION"
    });

    expect(template.toJSON()).toBeDefined();
  });

  it("creates a prod-promotion validation role for pull requests targeting prod", () => {
    const app = new cdk.App();
    applyCostAllocationTags(app, "dev");
    const stack = new GithubOidcStack(app, "DevGithubOidcStack", {
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

    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "brimax-github-actions-dev-prod-promotion-validation",
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: Match.objectLike({
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:repository": "maxdez86/brimax-life",
                "token.actions.githubusercontent.com:sub":
                  "repo:maxdez86/brimax-life:environment:dev",
                "token.actions.githubusercontent.com:event_name": "pull_request",
                "token.actions.githubusercontent.com:base_ref": "prod"
              })
            }
          })
        ])
      }
    });

    template.hasOutput("ProdPromotionValidationRoleArn", {});
    template.hasOutput("ProdPromotionValidationRoleSecretName", {
      Value: "AWS_ROLE_TO_ASSUME_DEV_VALIDATION"
    });
  });

  it("reuses an existing provider ARN when supplied", () => {
    const app = new cdk.App();
    applyCostAllocationTags(app, "prod");
    const stack = new GithubOidcStack(app, "ImportedProviderStack", {
      env: { account: "183286346090", region: "us-east-1" },
      existingProviderArn:
        "arn:aws:iam::183286346090:oidc-provider/token.actions.githubusercontent.com",
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

    template.resourceCountIs("AWS::IAM::OIDCProvider", 0);
    template.hasOutput("GithubOidcProviderArn", {
      Value: "arn:aws:iam::183286346090:oidc-provider/token.actions.githubusercontent.com"
    });
  });
});
