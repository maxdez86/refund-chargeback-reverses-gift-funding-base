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
  description = "Cloudflare API token with DNS and zone settings permissions."
  sensitive   = true
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for brimax.life."
  type        = string
}

variable "app_stack_name" {
  description = "CloudFormation stack name that owns the API custom domain outputs."
  type        = string
}

variable "api_domain" {
  description = "API hostname served by API Gateway."
  type        = string
}
