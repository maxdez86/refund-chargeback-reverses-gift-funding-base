variable "aws_profile" {
  description = "Optional AWS CLI profile name for local execution."
  type        = string
  default     = ""
}

variable "aws_region" {
  description = "AWS region used for ACM lookups."
  type        = string
}

variable "root_validation_record_name" {
  description = "DNS validation record name for the root domain certificate."
  type        = string
}

variable "root_validation_record_type" {
  description = "DNS validation record type for the root domain certificate."
  type        = string
}

variable "root_validation_record_value" {
  description = "DNS validation record value for the root domain certificate."
  type        = string
}

variable "www_validation_record_name" {
  description = "DNS validation record name for the www domain certificate."
  type        = string
}

variable "www_validation_record_type" {
  description = "DNS validation record type for the www domain certificate."
  type        = string
}

variable "www_validation_record_value" {
  description = "DNS validation record value for the www domain certificate."
  type        = string
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token with DNS and zone settings permissions."
  sensitive   = true
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for brimax.life."
  type        = string
}
