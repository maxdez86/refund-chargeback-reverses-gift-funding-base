
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { resourceName, type AppStage } from "@brimax/config";
import { Construct } from "constructs";

export interface DataStackProps extends cdk.StackProps {
  stage: AppStage;
}

export class DataStack extends cdk.Stack {
  readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    this.table = new dynamodb.Table(this, "WeddingTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: "PK",
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: "SK",
        type: dynamodb.AttributeType.STRING
      },
      tableName: resourceName("brimax-wedding", props.stage),
      timeToLiveAttribute: "ttl",
      // Always-on PITR (cheap, never blocks a delete) protects the system of
      // record — payments, RSVPs, gifts, guest messages. Deletion protection
      // and RETAIN are prod-only so non-prod stays freely tearable pre-launch.
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: props.stage === "prod",
      removalPolicy:
        props.stage === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY
    });

    this.table.addGlobalSecondaryIndex({
      indexName: "gsi1",
      partitionKey: {
        name: "GSI1PK",
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: "GSI1SK",
        type: dynamodb.AttributeType.STRING
      }
    });
  }
}
