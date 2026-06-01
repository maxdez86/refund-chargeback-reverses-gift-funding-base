output "backend_dsn_public" {
  description = "Public DSN used by the backend runtime for this stage."
  value       = sentry_key.backend_runtime.dsn["public"]
  sensitive   = true
}

output "backend_project_slug" {
  description = "Sentry backend project slug for this stage."
  value       = sentry_project.backend.slug
}

output "backend_project_name" {
  description = "Sentry backend project display name for this stage."
  value       = sentry_project.backend.name
}

output "team_slug" {
  description = "Shared Sentry team slug for the application."
  value       = local.team_slug
}
