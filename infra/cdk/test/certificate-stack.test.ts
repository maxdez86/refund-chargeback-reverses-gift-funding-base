import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { CertificateStack } from "../lib/stacks/certificate-stack";
import { applyCostAllocationTags } from "./support/tags";

describe("CertificateStack", () => {
  it("requests an ACM certificate for the apex and www domains", () => {
    const app = new cdk.App();
    applyCostAllocationTags(app, "prod");
    const stack = new CertificateStack(app, "TestCertificateStack", {
      apiDomain: "api.brimax.life",
      rootDomain: "brimax.life",
      stage: "prod",
      wwwDomain: "www.brimax.life"
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::CertificateManager::Certificate", 2);
    template.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: "brimax.life",
      SubjectAlternativeNames: ["www.brimax.life"],
      ValidationMethod: "DNS"
    });
    template.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: "api.brimax.life",
      ValidationMethod: "DNS",
      Tags: Match.arrayWith([
        { Key: "project", Value: "brimax-life" },
        { Key: "stage", Value: "prod" }
      ])
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Tags: Match.arrayWith([
        { Key: "project", Value: "brimax-life" },
        { Key: "stage", Value: "prod" }
      ])
    });

    expect(template.toJSON()).toBeDefined();
  });

  it("exposes certificate and validation outputs for OpenTofu", () => {
    const app = new cdk.App();
    applyCostAllocationTags(app, "prod");
    const stack = new CertificateStack(app, "TestCertificateOutputs", {
      apiDomain: "api.brimax.life",
      rootDomain: "brimax.life",
      stage: "prod",
      wwwDomain: "www.brimax.life"
    });
    const template = Template.fromStack(stack);

    template.hasOutput("CertificateArn", {});
    template.hasOutput("RootDomainValidationRecordName", {});
    template.hasOutput("RootDomainValidationRecordType", {});
    template.hasOutput("RootDomainValidationRecordValue", {});
    template.hasOutput("WwwDomainValidationRecordName", {});
    template.hasOutput("WwwDomainValidationRecordType", {});
    template.hasOutput("WwwDomainValidationRecordValue", {});
    template.hasOutput("ApiCertificateArn", {});
    template.hasOutput("ApiDomainValidationRecordName", {});
    template.hasOutput("ApiDomainValidationRecordType", {});
    template.hasOutput("ApiDomainValidationRecordValue", {});
  });
});
