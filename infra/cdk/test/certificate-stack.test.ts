import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { CertificateStack } from "../lib/stacks/certificate-stack";

describe("CertificateStack", () => {
  it("requests an ACM certificate for the apex and www domains", () => {
    const app = new cdk.App();
    const stack = new CertificateStack(app, "TestCertificateStack", {
      rootDomain: "brimax.life",
      stage: "prod",
      wwwDomain: "www.brimax.life"
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: "brimax.life",
      SubjectAlternativeNames: ["www.brimax.life"],
      ValidationMethod: "DNS"
    });

    expect(template.toJSON()).toBeDefined();
  });

  it("exposes certificate and validation outputs for OpenTofu", () => {
    const app = new cdk.App();
    const stack = new CertificateStack(app, "TestCertificateOutputs", {
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
  });
});
