output "ses_dkim_record_id_1" {
  value = cloudflare_dns_record.ses_dkim_1.id
}

output "ses_dkim_record_id_2" {
  value = cloudflare_dns_record.ses_dkim_2.id
}

output "ses_dkim_record_id_3" {
  value = cloudflare_dns_record.ses_dkim_3.id
}

output "ses_mail_from_mx_record_id" {
  value = cloudflare_dns_record.ses_mail_from_mx.id
}

output "ses_mail_from_txt_record_id" {
  value = cloudflare_dns_record.ses_mail_from_txt.id
}

output "ses_dmarc_record_id" {
  value = cloudflare_dns_record.ses_dmarc.id
}
