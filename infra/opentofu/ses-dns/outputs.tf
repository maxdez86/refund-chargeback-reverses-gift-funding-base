output "ses_dkim_record_id_1" {
  value = cloudflare_dns_record.ses_dkim_1.id
}

output "ses_dkim_record_id_2" {
  value = cloudflare_dns_record.ses_dkim_2.id
}

output "ses_dkim_record_id_3" {
  value = cloudflare_dns_record.ses_dkim_3.id
}
