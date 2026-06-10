// TESTMAX
import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cr from "aws-cdk-lib/custom-resources";
import { type AppStage } from "@brimax/config";
import { Construct } from "constructs";

export interface CertificateStackProps extends cdk.StackProps {
  apiDomain: string;
  rootDomain: string;
  stage: AppStage;
  wwwDomain: string;
}

export class CertificateStack extends cdk.Stack {
  readonly apiCertificate: acm.ICertificate;
  readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: CertificateStackProps) {
    super(scope, id, props);

    const certificate = new acm.CfnCertificate(this, "LandingCertificate", {
      domainName: props.rootDomain,
      subjectAlternativeNames: [props.wwwDomain],
      validationMethod: "DNS"
    });

    this.certificate = acm.Certificate.fromCertificateArn(
      this,
      "ImportedLandingCertificate",
      certificate.ref
    );
    const apiCertificate = new acm.CfnCertificate(this, "ApiCertificate", {
      domainName: props.apiDomain,
      validationMethod: "DNS"
    });

    this.apiCertificate = acm.Certificate.fromCertificateArn(
      this,
      "ImportedApiCertificate",
      apiCertificate.ref
    );

    const certificateDetails = new cr.AwsCustomResource(this, "CertificateDetails", {
      installLatestAwsSdk: false,
      onCreate: {
        service: "ACM",
        action: "describeCertificate",
        parameters: {
          CertificateArn: certificate.ref
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${certificate.ref}:details`)
      },
      onUpdate: {
        service: "ACM",
        action: "describeCertificate",
        parameters: {
          CertificateArn: certificate.ref
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${certificate.ref}:details`)
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE
      })
    });

    certificateDetails.node.addDependency(certificate);

    const apiCertificateDetails = new cr.AwsCustomResource(this, "ApiCertificateDetails", {
      installLatestAwsSdk: false,
      onCreate: {
        service: "ACM",
        action: "describeCertificate",
        parameters: {
          CertificateArn: apiCertificate.ref
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${apiCertificate.ref}:details`)
      },
      onUpdate: {
        service: "ACM",
        action: "describeCertificate",
        parameters: {
          CertificateArn: apiCertificate.ref
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${apiCertificate.ref}:details`)
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE
      })
    });

    apiCertificateDetails.node.addDependency(apiCertificate);

    new cdk.CfnOutput(this, "CertificateArn", {
      value: certificate.ref
    });

    new cdk.CfnOutput(this, "ApiCertificateArn", {
      value: apiCertificate.ref
    });

    new cdk.CfnOutput(this, "RootDomainValidationRecordName", {
      value: certificateDetails.getResponseField("Certificate.DomainValidationOptions.0.ResourceRecord.Name")
    });

    new cdk.CfnOutput(this, "RootDomainValidationRecordType", {
      value: certificateDetails.getResponseField("Certificate.DomainValidationOptions.0.ResourceRecord.Type")
    });

    new cdk.CfnOutput(this, "RootDomainValidationRecordValue", {
      value: certificateDetails.getResponseField("Certificate.DomainValidationOptions.0.ResourceRecord.Value")
    });

    new cdk.CfnOutput(this, "WwwDomainValidationRecordName", {
      value: certificateDetails.getResponseField("Certificate.DomainValidationOptions.1.ResourceRecord.Name")
    });

    new cdk.CfnOutput(this, "WwwDomainValidationRecordType", {
      value: certificateDetails.getResponseField("Certificate.DomainValidationOptions.1.ResourceRecord.Type")
    });

    new cdk.CfnOutput(this, "WwwDomainValidationRecordValue", {
      value: certificateDetails.getResponseField("Certificate.DomainValidationOptions.1.ResourceRecord.Value")
    });

    new cdk.CfnOutput(this, "ApiDomainValidationRecordName", {
      value: apiCertificateDetails.getResponseField("Certificate.DomainValidationOptions.0.ResourceRecord.Name")
    });

    new cdk.CfnOutput(this, "ApiDomainValidationRecordType", {
      value: apiCertificateDetails.getResponseField("Certificate.DomainValidationOptions.0.ResourceRecord.Type")
    });

    new cdk.CfnOutput(this, "ApiDomainValidationRecordValue", {
      value: apiCertificateDetails.getResponseField("Certificate.DomainValidationOptions.0.ResourceRecord.Value")
    });
  }
}
