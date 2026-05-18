import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as s3 from "aws-cdk-lib/aws-s3";
import { resourceName, type AppStage } from "@brimax/config";
import { Construct } from "constructs";
import { MediaBucketConstruct } from "../constructs/media/media-bucket-construct";
import {
  StaticSiteConstruct,
  type StaticSiteConstructProps
} from "../constructs/website/static-site-construct";

export interface EdgeStackProps extends cdk.StackProps, StaticSiteConstructProps {
  certificate?: acm.ICertificate;
  rootDomain?: string;
  siteAssetPath: string;
  stage: AppStage;
  wwwDomain?: string;
}

export class EdgeStack extends cdk.Stack {
  readonly distribution: cloudfront.Distribution;
  readonly mediaBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);

    const media = new MediaBucketConstruct(this, "Media", { stage: props.stage });
    this.mediaBucket = media.bucket;

    const site = new StaticSiteConstruct(this, "Site", { ...props, mediaBucket: media.bucket });
    this.distribution = site.distribution;

    new cdk.CfnOutput(this, "MediaBucketName", {
      description: "S3 bucket fronted by CloudFront under /media/*. Upload videos/photos here.",
      exportName: resourceName("BrimaxMediaBucketName", props.stage),
      value: media.bucket.bucketName
    });
  }
}
