// TESTMAX
import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { APP_STAGES, type AppStage } from "@brimax/config";
import { Construct } from "constructs";

interface StageBackendConfig {
  lockTableName: string;
  stateBucketName: string;
}

export interface GithubOidcStackProps extends cdk.StackProps {
  githubRepository: string;
  stageConfigs: Record<AppStage, StageBackendConfig>;
}

interface DeployRoleProps {
  bootstrapQualifier: string;
  githubEnvironment: AppStage;
  githubRepository: string;
  lockTableName: string;
  provider: iam.IOpenIdConnectProvider;
  roleName: string;
  stackNameWildcard: string;
  stateBucketName: string;
  dataTablePrefix?: string;
}

export class GithubOidcStack extends cdk.Stack {
  readonly githubProviderArn: string;
  readonly deployRoles: Record<AppStage, iam.Role>;

  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    const provider = new iam.OpenIdConnectProvider(this, "GithubOidcProvider", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"]
    });

    this.githubProviderArn = provider.openIdConnectProviderArn;

    this.deployRoles = {
      dev: this.createDeployRole("GithubActionsDevDeployRole", {
        bootstrapQualifier: "hnb659fds",
        githubEnvironment: "dev",
        githubRepository: props.githubRepository,
        lockTableName: props.stageConfigs.dev.lockTableName,
        provider,
        roleName: "brimax-github-actions-dev-deploy",
        stackNameWildcard: "dev-*",
        stateBucketName: props.stageConfigs.dev.stateBucketName,
        dataTablePrefix: "dev-"
      }),
      // Preserve the original logical ID so the existing prod role in
      // BrimaxGithubOidcStack is updated in-place instead of recreated.
      prod: this.createDeployRole("GithubActionsDeployRole", {
        bootstrapQualifier: "hnb659fds",
        githubEnvironment: "prod",
        githubRepository: props.githubRepository,
        lockTableName: props.stageConfigs.prod.lockTableName,
        provider,
        roleName: "brimax-github-actions-prod-deploy",
        stackNameWildcard: "Brimax*",
        stateBucketName: props.stageConfigs.prod.stateBucketName
      })
    };

    new cdk.CfnOutput(this, "GithubOidcProviderArn", {
      value: this.githubProviderArn
    });

    for (const stage of APP_STAGES) {
      const stageUpper = stage.toUpperCase();
      const logicalPrefix = stage === "prod" ? "Prod" : "Dev";

      new cdk.CfnOutput(this, `GithubActions${logicalPrefix}DeployRoleArn`, {
        value: this.deployRoles[stage].roleArn
      });

      new cdk.CfnOutput(this, `GithubActions${logicalPrefix}DeployRoleSecretName`, {
        value: `AWS_ROLE_TO_ASSUME_${stageUpper}`
      });

      new cdk.CfnOutput(this, `GithubActions${logicalPrefix}EnvironmentName`, {
        value: stage
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
            "token.actions.githubusercontent.com:sub": `repo:${props.githubRepository}:environment:${props.githubEnvironment}`
          }
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
      description: `GitHub Actions deploy role for the ${props.githubEnvironment} environment.`
    });

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "ReadStageCloudFormation",
        actions: ["cloudformation:DescribeStacks", "cloudformation:GetTemplate"],
        // IAM `*` spans `/`, so `stack/dev-*` matches `stack/dev-BrimaxAppStack/<guid>`.
        // The wildcard subsumes the old per-stack list so a new stack never needs a
        // bootstrap re-run.
        resources: [
          `arn:aws:cloudformation:${this.region}:${this.account}:stack/${props.stackNameWildcard}`,
          this.stackArnFor("CDKToolkit")
        ]
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

    if (props.dataTablePrefix) {
      // Direct DynamoDB data access for the prod-promotion integration suite,
      // which runs under the dev deploy role. The `dev-*` wildcard means a future
      // validation table needs no bootstrap re-run. Prod omits this entirely — it
      // never runs the suite.
      const dataTableArn = this.lockTableArnFor(`${props.dataTablePrefix}*`);

      role.addToPrincipalPolicy(
        new iam.PolicyStatement({
          sid: "DevDataTableAccess",
          actions: [
            "dynamodb:DescribeTable",
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:DeleteItem",
            "dynamodb:Query",
            "dynamodb:Scan"
          ],
          resources: [dataTableArn, `${dataTableArn}/index/*`]
        })
      );
    }

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
}
