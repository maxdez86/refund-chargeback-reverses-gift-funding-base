import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import { type AppStage } from "@brimax/config";
import { Construct } from "constructs";
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

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);

    const site = new StaticSiteConstruct(this, "Site", props);
    this.distribution = site.distribution;
  }
}
