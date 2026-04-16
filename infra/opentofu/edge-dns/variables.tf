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
  description = "Cloudflare API token with DNS and zone settings permissions."
  sensitive   = true
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for brimax.life."
  type        = string
}

variable "edge_stack_name" {
  description = "CloudFormation stack name that owns the CloudFront outputs."
  type        = string
}

variable "root_domain" {
  description = "Canonical apex hostname."
  type        = string
}

variable "www_domain" {
  description = "WWW hostname that also resolves through Cloudflare."
  type        = string
}
