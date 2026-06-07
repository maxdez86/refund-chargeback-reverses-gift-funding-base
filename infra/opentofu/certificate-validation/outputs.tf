output "root_validation_record_id" {
  value = cloudflare_dns_record.root_certificate_validation.id
}

output "www_validation_record_id" {
  value = cloudflare_dns_record.www_certificate_validation.id
}

output "api_validation_record_id" {
  value = cloudflare_dns_record.api_certificate_validation.id
}
