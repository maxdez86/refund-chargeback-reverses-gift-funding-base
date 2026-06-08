### Test
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

resource "cloudflare_dns_record" "root_certificate_validation" {
  content = trimsuffix(var.root_validation_record_value, ".")
  name    = trimsuffix(var.root_validation_record_name, ".")
  proxied = false
  ttl     = 1
  type    = var.root_validation_record_type
  zone_id = var.cloudflare_zone_id
}

resource "cloudflare_dns_record" "www_certificate_validation" {
  content = trimsuffix(var.www_validation_record_value, ".")
  name    = trimsuffix(var.www_validation_record_name, ".")
  proxied = false
  ttl     = 1
  type    = var.www_validation_record_type
  zone_id = var.cloudflare_zone_id
}

resource "cloudflare_dns_record" "api_certificate_validation" {
  content = trimsuffix(var.api_validation_record_value, ".")
  name    = trimsuffix(var.api_validation_record_name, ".")
  proxied = false
  ttl     = 1
  type    = var.api_validation_record_type
  zone_id = var.cloudflare_zone_id
}
