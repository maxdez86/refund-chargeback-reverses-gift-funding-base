variable "aws_profile" {
  description = "Optional AWS CLI profile name for local execution."
  type        = string
  default     = ""
}

variable "aws_region" {
  description = "AWS region used for CloudFormation lookups."
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
