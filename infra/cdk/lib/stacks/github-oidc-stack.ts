import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { type AppStage } from "@brimax/config";
import { Construct } from "constructs";

export interface GithubOidcStackProps extends cdk.StackProps {
  existingProviderArn?: string;
  githubRepository: string;
  lockTableName: string;
  stage: AppStage;
  stateBucketName: string;
}

interface DeployRoleProps {
  branchName: string;
  bootstrapQualifier: string;
  githubEnvironment: AppStage;
  githubRepository: string;
  lockTableName: string;
  provider: iam.IOpenIdConnectProvider;
  roleName: string;
  stateBucketName: string;
  stackNames: string[];
}

interface ValidationRoleProps {
  githubEnvironment: AppStage;
  githubRepository: string;
  provider: iam.IOpenIdConnectProvider;
  roleName: string;
  stackName: string;
  tableName: string;
}

export class GithubOidcStack extends cdk.Stack {
  readonly githubProviderArn: string;
  readonly deployRole: iam.Role;
  readonly prodPromotionValidationRole?: iam.Role;

  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    const provider = props.existingProviderArn
      ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          "ImportedGithubOidcProvider",
          props.existingProviderArn
        )
      : new iam.OpenIdConnectProvider(this, "GithubOidcProvider", {
          url: "https://token.actions.githubusercontent.com",
          clientIds: ["sts.amazonaws.com"]
        });

    this.githubProviderArn = provider.openIdConnectProviderArn;

    const stackNames =
      props.stage === "dev"
        ? [
            "CDKToolkit",
            "dev-BrimaxPlatformStack",
            "dev-BrimaxCertificateStack",
            "dev-BrimaxEdgeStack",
            "dev-BrimaxAppStack"
          ]
        : [
            "CDKToolkit",
            "BrimaxPlatformStack",
            "BrimaxCertificateStack",
            "BrimaxEdgeStack",
            "BrimaxAppStack"
          ];

    this.deployRole = this.createDeployRole("GithubActionsDeployRole", {
      branchName: props.stage,
      bootstrapQualifier: "hnb659fds",
      githubEnvironment: props.stage,
      githubRepository: props.githubRepository,
      lockTableName: props.lockTableName,
      provider,
      roleName: `brimax-github-actions-${props.stage}-deploy`,
      stateBucketName: props.stateBucketName,
      stackNames
    });

    new cdk.CfnOutput(this, "GithubOidcProviderArn", {
      value: this.githubProviderArn
    });

    new cdk.CfnOutput(this, "GithubActionsDeployRoleArn", {
      value: this.deployRole.roleArn
    });

    new cdk.CfnOutput(this, "GithubActionsDeployRoleSecretName", {
      value: `AWS_ROLE_TO_ASSUME_${props.stage.toUpperCase()}`
    });

    new cdk.CfnOutput(this, "GithubActionsEnvironmentName", {
      value: props.stage
    });

    if (props.stage === "dev") {
      this.prodPromotionValidationRole = this.createProdPromotionValidationRole(
        "ProdPromotionValidationRole",
        {
          githubEnvironment: "dev",
          githubRepository: props.githubRepository,
          provider,
          roleName: "brimax-github-actions-dev-prod-promotion-validation",
          stackName: "dev-BrimaxAppStack",
          tableName: "dev-brimax-wedding"
        }
      );

      new cdk.CfnOutput(this, "ProdPromotionValidationRoleArn", {
        value: this.prodPromotionValidationRole.roleArn
      });

      new cdk.CfnOutput(this, "ProdPromotionValidationRoleSecretName", {
        value: "AWS_ROLE_TO_ASSUME_DEV_VALIDATION"
      });
    }
  }

  private createDeployRole(id: string, props: DeployRoleProps) {
    const role = new iam.Role(this, id, {
      roleName: props.roleName,
      assumedBy: new iam.FederatedPrincipal(
        props.provider.openIdConnectProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:repository": props.githubRepository,
            "token.actions.githubusercontent.com:sub": `repo:${props.githubRepository}:environment:${props.githubEnvironment}`,
            "token.actions.githubusercontent.com:ref": `refs/heads/${props.branchName}`
          }
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
      description: `GitHub Actions deploy role for the ${props.githubEnvironment} environment.`
    });

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "ReadStageCloudFormation",
        actions: ["cloudformation:DescribeStacks"],
        resources: props.stackNames.map((stackName) => this.stackArnFor(stackName))
      })
    );

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "ReadAcmCertificates",
        actions: ["acm:DescribeCertificate", "acm:ListCertificates"],
        resources: ["*"]
      })
    );

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "ReadBootstrapVersion",
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/cdk-bootstrap/${props.bootstrapQualifier}/version`
        ]
      })
    );

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "OpenTofuStateBucketAccess",
        actions: [
          "s3:GetBucketLocation",
          "s3:GetBucketVersioning",
          "s3:ListBucket"
        ],
        resources: [this.bucketArnFor(props.stateBucketName)]
      })
    );

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "OpenTofuStateObjectAccess",
        actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        resources: [`${this.bucketArnFor(props.stateBucketName)}/*`]
      })
    );

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "OpenTofuLockTableAccess",
        actions: [
          "dynamodb:DescribeTable",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:UpdateItem"
        ],
        resources: [this.lockTableArnFor(props.lockTableName)]
      })
    );

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "CdkBootstrapAssumeRoles",
        actions: ["sts:AssumeRole", "sts:TagSession"],
        resources: [
          "deploy-role",
          "file-publishing-role",
          "image-publishing-role",
          "lookup-role"
        ].map((roleType) =>
          `arn:aws:iam::${this.account}:role/cdk-${props.bootstrapQualifier}-${roleType}-${this.account}-${this.region}`
        )
      })
    );

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "ReadCallerIdentity",
        actions: ["sts:GetCallerIdentity"],
        resources: ["*"]
      })
    );

    return role;
  }

  private bucketArnFor(bucketName: string) {
    return `arn:aws:s3:::${bucketName}`;
  }

  private lockTableArnFor(tableName: string) {
    return `arn:aws:dynamodb:${this.region}:${this.account}:table/${tableName}`;
  }

  private stackArnFor(stackName: string) {
    return `arn:aws:cloudformation:${this.region}:${this.account}:stack/${stackName}/*`;
  }

  private createProdPromotionValidationRole(id: string, props: ValidationRoleProps) {
    const role = new iam.Role(this, id, {
      roleName: props.roleName,
      assumedBy: new iam.FederatedPrincipal(
        props.provider.openIdConnectProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:repository": props.githubRepository,
            "token.actions.githubusercontent.com:sub": `repo:${props.githubRepository}:environment:${props.githubEnvironment}`,
            "token.actions.githubusercontent.com:event_name": "pull_request",
            "token.actions.githubusercontent.com:base_ref": "prod"
          }
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
      description: "GitHub Actions validation role for prod-promotion integration tests against dev."
    });

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "ReadDevAppStackOutputs",
        actions: ["cloudformation:DescribeStacks"],
        resources: [this.stackArnFor(props.stackName)]
      })
    );

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "ReadWriteIntegrationOwnedWeddingData",
        actions: [
          "dynamodb:DescribeTable",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ],
        resources: [this.lockTableArnFor(props.tableName), `${this.lockTableArnFor(props.tableName)}/index/*`]
      })
    );

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "ReadCallerIdentity",
        actions: ["sts:GetCallerIdentity"],
        resources: ["*"]
      })
    );

    return role;
  }
}
