terraform {
  required_version = ">= 1.8.0"

  required_providers {
    sentry = {
      source  = "jianyuan/sentry"
      version = "~> 0.14.6"
    }
  }

  backend "s3" {}
}

provider "sentry" {}

data "sentry_organization" "main" {
  slug = var.sentry_organization_slug
}

locals {
  create_team          = var.create_team != null ? var.create_team : var.stage == "prod"
  team_slug            = local.create_team ? sentry_team.app[0].slug : var.sentry_team_slug
  backend_project_name = var.backend_project_name != null ? var.backend_project_name : "Brimax API (${upper(var.stage)})"
  backend_project_slug = var.backend_project_slug != null ? var.backend_project_slug : "brimax-api-${var.stage}"
}

resource "sentry_team" "app" {
  count = local.create_team ? 1 : 0

  organization = data.sentry_organization.main.slug
  name         = var.sentry_team_name
  slug         = var.sentry_team_slug
}

resource "sentry_project" "backend" {
  organization = data.sentry_organization.main.slug

  teams         = [local.team_slug]
  name          = local.backend_project_name
  slug          = local.backend_project_slug
  platform      = "node"
  default_rules = false
  resolve_age   = 720
}

resource "sentry_key" "backend_runtime" {
  organization = sentry_project.backend.organization
  project      = sentry_project.backend.id
  name         = "${upper(var.stage)} Backend Runtime"
}
