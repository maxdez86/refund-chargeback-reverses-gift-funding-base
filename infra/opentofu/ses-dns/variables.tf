variable "aws_profile" {
  description = "Optional AWS CLI profile name for local execution."
  type        = string
  default     = ""
}

variable "aws_region" {
  description = "AWS region used for CloudFormation lookups."
  type        = string
}

variable "stage" {
  description = "Deployment stage this module is associated with."
  type        = string
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token with DNS permissions."
  sensitive   = true
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for brimax.life."
  type        = string
}

variable "ses_domain_identity" {
  description = "SES sender domain identity."
  type        = string
}

variable "ses_mail_from_domain" {
  description = "Custom SES MAIL FROM subdomain."
  type        = string
}

variable "ses_mail_from_mx_value" {
  description = "SES MAIL FROM MX record target including priority."
  type        = string
}

variable "ses_mail_from_txt_value" {
  description = "SES MAIL FROM SPF TXT value."
  type        = string
}

variable "ses_dkim_record_name_1" {
  description = "SES DKIM CNAME record name 1."
  type        = string
}

variable "ses_dkim_record_value_1" {
  description = "SES DKIM CNAME record value 1."
  type        = string
}

variable "ses_dkim_record_name_2" {
  description = "SES DKIM CNAME record name 2."
  type        = string
}

variable "ses_dkim_record_value_2" {
  description = "SES DKIM CNAME record value 2."
  type        = string
}

variable "ses_dkim_record_name_3" {
  description = "SES DKIM CNAME record name 3."
  type        = string
}

variable "ses_dkim_record_value_3" {
  description = "SES DKIM CNAME record value 3."
  type        = string
}
