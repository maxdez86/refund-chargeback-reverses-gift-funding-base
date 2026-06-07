import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { captureAwsClient } from "../../lib/xray";

const client = captureAwsClient(new DynamoDBClient({}));

export const dynamoDbDocumentClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});
