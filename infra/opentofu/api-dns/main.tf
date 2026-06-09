# TESTMAX
terraform {
  required_version = ">= 1.8.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }

    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  backend "s3" {}
}

provider "aws" {
  profile = var.aws_profile != "" ? var.aws_profile : null
  region  = var.aws_region

  default_tags {
    tags = {
      project = "brimax-life"
      stage   = var.stage
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

data "aws_cloudformation_stack" "app" {
  name = var.app_stack_name
}

locals {
  api_target = trimsuffix(data.aws_cloudformation_stack.app.outputs["ApiCustomDomainRegionalTarget"], ".")
}

resource "cloudflare_dns_record" "api" {
  content = local.api_target
  name    = var.api_domain
  proxied = false
  ttl     = 1
  type    = "CNAME"
  zone_id = var.cloudflare_zone_id
}
