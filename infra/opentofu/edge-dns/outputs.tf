output "apex_record_id" {
  value = cloudflare_dns_record.apex.id
}

output "www_record_id" {
  value = cloudflare_dns_record.www.id
}
