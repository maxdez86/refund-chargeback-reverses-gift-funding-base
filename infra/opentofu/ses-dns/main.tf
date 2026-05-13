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
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

resource "cloudflare_dns_record" "ses_dkim_1" {
  content = trimsuffix(var.ses_dkim_record_value_1, ".")
  name    = trimsuffix(var.ses_dkim_record_name_1, ".")
  proxied = false
  ttl     = 1
  type    = "CNAME"
  zone_id = var.cloudflare_zone_id
}

resource "cloudflare_dns_record" "ses_dkim_2" {
  content = trimsuffix(var.ses_dkim_record_value_2, ".")
  name    = trimsuffix(var.ses_dkim_record_name_2, ".")
  proxied = false
  ttl     = 1
  type    = "CNAME"
  zone_id = var.cloudflare_zone_id
}

resource "cloudflare_dns_record" "ses_dkim_3" {
  content = trimsuffix(var.ses_dkim_record_value_3, ".")
  name    = trimsuffix(var.ses_dkim_record_name_3, ".")
  proxied = false
  ttl     = 1
  type    = "CNAME"
  zone_id = var.cloudflare_zone_id
}
