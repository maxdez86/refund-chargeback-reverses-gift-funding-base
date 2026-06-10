// TESTMAX
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import { type AppStage } from "@brimax/config";
import { Construct } from "constructs";

export interface PlatformStackProps extends cdk.StackProps {
  stage: AppStage;
}

export class PlatformStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PlatformStackProps) {
    super(scope, id, props);

    const stateBucket = new s3.Bucket(this, "TofuStateBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true
    });

    const lockTable = new dynamodb.Table(this, "TofuLockTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: "LockID",
        type: dynamodb.AttributeType.STRING
      },
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true
      }
    });

    new cdk.CfnOutput(this, "TofuStateBucketName", {
      value: stateBucket.bucketName
    });

    new cdk.CfnOutput(this, "TofuLockTableName", {
      value: lockTable.tableName
    });

    new cdk.CfnOutput(this, "TofuBackendRegion", {
      value: cdk.Stack.of(this).region
    });
  }
}
