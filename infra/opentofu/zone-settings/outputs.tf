output "ssl_setting_id" {
  value = cloudflare_zone_setting.ssl.id
}

output "always_use_https_setting_id" {
  value = cloudflare_zone_setting.always_use_https.id
}

output "min_tls_version_setting_id" {
  value = cloudflare_zone_setting.min_tls_version.id
}
