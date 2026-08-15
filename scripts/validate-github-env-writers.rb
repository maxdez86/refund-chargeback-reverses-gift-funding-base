#!/usr/bin/env ruby
# frozen_string_literal: true

require "shellwords"
require "yaml"

VARIABLE_KEYS = %w[
  STAGE AWS_REGION ROOT_DOMAIN CONTACT_EMAIL API_DOMAIN WWW_DOMAIN
  CLOUDFLARE_ZONE_ID OBSERVABILITY_ALERT_EMAIL XRAY_ENABLED ASAAS_ENV
  ASAAS_API_BASE_URL TURNSTILE_SITE_KEY PAYMENTS_TEST_GIFT_ID
  PAYMENTS_TEST_GIFT_QUANTITY TOFU_STATE_KEY_PREFIX SENTRY_ORG
  SENTRY_TEAM_SLUG
].freeze

SECRET_KEYS = %w[
  CLOUDFLARE_API_TOKEN ASAAS_API_KEY ASAAS_WEBHOOK_TOKEN
  WHATSAPP_APP_SECRET WHATSAPP_VERIFY_TOKEN TURNSTILE_SECRET_KEY
  PAYMENTS_TEST_PAYER_NAME PAYMENTS_TEST_PAYER_EMAIL
  PAYMENTS_TEST_PAYER_CPF PAYMENTS_TEST_PAYER_PHONE SENTRY_AUTH_TOKEN
].freeze

EXPECTED_MAPPINGS = {
  **VARIABLE_KEYS.to_h { |key| [key, "$" + "{{ vars.#{key} }}"] },
  **SECRET_KEYS.to_h { |key| [key, "$" + "{{ secrets.#{key} }}"] }
}.freeze

EXPECTED_WRITERS = {
  "deploy-dev.yml" => %w[
    deploy-frontend
    apply-dev-sentry
    deploy-backend
    apply-dev-landing-dns
    apply-dev-api-dns
    sync-dev-asaas-webhook
  ],
  "deploy-prod.yml" => %w[
    deploy-frontend
    apply-prod-sentry
    deploy-backend
    apply-prod-landing-dns
    apply-prod-api-dns
    sync-prod-asaas-webhook
    apply-prod-ses-dns
  ]
}.freeze

DEFAULT_WORKFLOWS = %w[
  .github/workflows/deploy-dev.yml
  .github/workflows/deploy-prod.yml
].freeze

def command_tokens(command)
  Shellwords.split(command.gsub(/\\\r?\n\s*/, " "))
end

def writer_arguments(command)
  tokens = command_tokens(command)
  script_index = tokens.index { |token| token.end_with?("scripts/write-github-env-file.sh") }
  return unless script_index

  arguments = tokens.drop(script_index + 1)
  return unless arguments[1] == "full-stage"

  arguments
end

def validate_writer(file, job_name, step, arguments)
  location = "#{file} job #{job_name} stage env writer"
  expected_environment = File.basename(file) == "deploy-dev.yml" ? "dev" : "prod"
  expected_destination = expected_environment == "dev" ? ".env.dev" : ".env"
  invocation_errors = []
  invocation_errors << "destination #{expected_destination.inspect}" unless arguments[0] == expected_destination
  invocation_errors << "environment #{expected_environment.inspect}" unless arguments[2] == expected_environment
  invocation_errors << "at least one required key" if arguments.length < 4
  unless invocation_errors.empty?
    abort "#{location} must specify #{invocation_errors.join(", ")}"
  end

  required_keys = arguments.drop(3)
  unknown_keys = required_keys.reject { |key| EXPECTED_MAPPINGS.key?(key) }
  abort "#{location} has unknown required keys: #{unknown_keys.join(", ")}" unless unknown_keys.empty?

  step_env = step["env"] || {}
  missing_keys = required_keys.reject { |key| step_env.key?(key) }
  abort "#{location} has missing required mappings: #{missing_keys.join(", ")}" unless missing_keys.empty?

  mapped_known_keys = step_env.keys & EXPECTED_MAPPINGS.keys
  incorrect_keys = mapped_known_keys.reject { |key| step_env[key] == EXPECTED_MAPPINGS[key] }
  return if incorrect_keys.empty?

  details = incorrect_keys.map do |key|
    "#{key} (expected #{EXPECTED_MAPPINGS[key]}, found #{step_env[key].inspect})"
  end
  abort "#{location} has incorrect mappings: #{details.join(", ")}"
end

def expected_writer_counts
  EXPECTED_WRITERS.each_with_object(Hash.new(0)) do |(file, jobs), counts|
    jobs.each { |job| counts[[file, job]] += 1 }
  end
end

def validate_inventory(discovered_counts)
  expected_counts = expected_writer_counts
  missing = expected_counts.keys.reject { |identity| discovered_counts.key?(identity) }
  unexpected = discovered_counts.keys.reject { |identity| expected_counts.key?(identity) }
  duplicates = discovered_counts.filter_map do |identity, count|
    identity if expected_counts.key?(identity) && count > 1
  end

  errors = []
  errors << "missing full-stage env writers: #{missing.map { |file, job| "#{file}:#{job}" }.join(", ")}" unless missing.empty?
  errors << "unexpected full-stage env writers: #{unexpected.map { |file, job| "#{file}:#{job}" }.join(", ")}" unless unexpected.empty?
  errors << "duplicate full-stage env writers: #{duplicates.map { |file, job| "#{file}:#{job}" }.join(", ")}" unless duplicates.empty?
  abort errors.join("\n") unless errors.empty?
end

workflow_files = ARGV.empty? ? DEFAULT_WORKFLOWS : ARGV
discovered_counts = Hash.new(0)

workflow_files.each do |file|
  workflow = YAML.load_file(file)
  workflow.fetch("jobs").each do |job_name, job|
    Array(job["steps"]).each do |step|
      arguments = writer_arguments(step["run"].to_s)
      next unless arguments

      identity = [File.basename(file), job_name]
      discovered_counts[identity] += 1
      validate_writer(file, job_name, step, arguments)
    end
  end
end

validate_inventory(discovered_counts)
puts "validated #{discovered_counts.values.sum} full-stage env writer mappings"
