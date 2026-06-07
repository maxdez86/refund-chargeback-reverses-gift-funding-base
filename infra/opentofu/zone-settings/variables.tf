variable "cloudflare_api_token" {
  description = "Cloudflare API token with zone settings permissions."
  sensitive   = true
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for brimax.life."
  type        = string
}
