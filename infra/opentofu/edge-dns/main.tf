# TESTMAX2
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

data "aws_cloudformation_stack" "edge" {
  name = var.edge_stack_name
}

locals {
  cloudfront_domain = trimsuffix(data.aws_cloudformation_stack.edge.outputs["CloudFrontDistributionDomainName"], ".")
}

resource "cloudflare_dns_record" "apex" {
  content = local.cloudfront_domain
  name    = var.root_domain
  proxied = true
  ttl     = 1
  type    = "CNAME"
  zone_id = var.cloudflare_zone_id
}

resource "cloudflare_dns_record" "www" {
  content = local.cloudfront_domain
  name    = var.www_domain
  proxied = true
  ttl     = 1
  type    = "CNAME"
  zone_id = var.cloudflare_zone_id
}
