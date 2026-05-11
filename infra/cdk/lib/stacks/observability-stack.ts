import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { type AppStage } from "@brimax/config";
import { Construct } from "constructs";

export interface ObservabilityStackProps extends cdk.StackProps {
  distribution: cloudfront.IDistribution;
  httpApi: apigwv2.IHttpApi;
  stage: AppStage;
  table: dynamodb.ITable;
}

export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    new cdk.CfnOutput(this, "DistributionId", {
      value: props.distribution.distributionId
    });

    new cdk.CfnOutput(this, "HttpApiId", {
      value: props.httpApi.apiId
    });

    new cdk.CfnOutput(this, "TableName", {
      value: props.table.tableName
    });
  }
}
