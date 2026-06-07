import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { type AppStage } from "@brimax/config";

export interface MediaBucketConstructProps {
  stage: AppStage;
}

export class MediaBucketConstruct extends Construct {
  readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, _props: MediaBucketConstructProps) {
    super(scope, id);

    this.bucket = new s3.Bucket(this, "MediaBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true
    });
  }
}
