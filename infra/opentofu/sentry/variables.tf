variable "stage" {
  description = "Deployment stage this Sentry project key should represent."
  type        = string

  validation {
    condition     = contains(["prod", "dev"], var.stage)
    error_message = "stage must be one of: prod, dev."
  }
}

variable "sentry_organization_slug" {
  description = "The Sentry organization slug."
  type        = string
  default     = "brimax"
}

variable "sentry_team_slug" {
  description = "Shared Sentry team slug for the application."
  type        = string
  default     = "brimax-life"
}

variable "sentry_team_name" {
  description = "Human-readable Sentry team name."
  type        = string
  default     = "Brimax Life"
}

variable "create_team" {
  description = "Whether this stage state should manage the shared application team."
  type        = bool
  default     = null
  nullable    = true
}

variable "backend_project_name" {
  description = "Optional override for the backend Sentry project name."
  type        = string
  default     = null
  nullable    = true
}

variable "backend_project_slug" {
  description = "Optional override for the backend Sentry project slug."
  type        = string
  default     = null
  nullable    = true
}
