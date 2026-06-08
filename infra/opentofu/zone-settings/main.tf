### Test
terraform {
  required_version = ">= 1.8.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  backend "s3" {}
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

resource "cloudflare_zone_setting" "ssl" {
  setting_id = "ssl"
  value      = "strict"
  zone_id    = var.cloudflare_zone_id
}

resource "cloudflare_zone_setting" "always_use_https" {
  setting_id = "always_use_https"
  value      = "on"
  zone_id    = var.cloudflare_zone_id
}

resource "cloudflare_zone_setting" "min_tls_version" {
  setting_id = "min_tls_version"
  value      = "1.2"
  zone_id    = var.cloudflare_zone_id
}
