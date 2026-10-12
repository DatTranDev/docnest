# Offline plans only: the mocked provider never contacts Google Cloud or provisions resources.
mock_provider "google" {}

override_data {
  target = data.google_project.lab
  values = { number = "123456789012" }
}

variables {
  project_id        = "example-lab"
  billing_account   = "000000-000000-000000"
  budget_start_date = "2026-10-12"
  web_origin        = "https://editor.example.com"
  snapshots_bucket  = "example-lab-snapshots"
  results_bucket    = "example-lab-results"
  backups_bucket    = "example-lab-backups"
}

run "storage_only" {
  command = plan
  assert {
    condition     = length(google_compute_instance.vm) == 0 && length(google_compute_address.vm) == 0 && length(google_container_cluster.lab) == 0 && length(google_service_account_iam_member.workload) == 0
    error_message = "The none environment must not create compute, a paid IP or bindings to an absent GKE identity pool."
  }
  assert {
    condition     = google_billing_budget.learning.budget_filter[0].custom_period[0].start_date[0].day == 12 && google_billing_budget.learning.budget_filter[0].custom_period[0].start_date[0].month == 10 && google_billing_budget.learning.budget_filter[0].custom_period[0].start_date[0].year == 2026
    error_message = "Budget must use the configured cumulative start date."
  }
}

run "vm_only" {
  command = plan
  variables { environment = "vm" }
  override_resource {
    target          = google_compute_address.vm[0]
    values          = { address = "203.0.113.10" }
    override_during = plan
  }
  assert {
    condition     = length(google_compute_instance.vm) == 1 && length(google_compute_address.vm) == 1 && length(google_container_cluster.lab) == 0 && length(google_service_account_iam_member.workload) == 0
    error_message = "VM deployment requires one VM/static IP and no GKE resources/bindings."
  }
  assert {
    condition     = google_compute_instance.vm[0].network_interface[0].access_config[0].nat_ip == "203.0.113.10" && output.vm_public_ip == "203.0.113.10"
    error_message = "The VM NIC and DNS output must use the same reserved static IP."
  }
}

run "gke_only" {
  command = plan
  variables { environment = "gke" }
  assert {
    condition     = length(google_compute_instance.vm) == 0 && length(google_compute_address.vm) == 0 && length(google_container_cluster.lab) == 1 && length(google_service_account_iam_member.workload) == 3
    error_message = "GKE deployment requires only the cluster and its three workload bindings."
  }
}

run "reject_invalid_date" {
  command = plan
  variables { budget_start_date = "2026-02-30" }
  expect_failures = [var.budget_start_date]
}

run "reject_origin_path" {
  command = plan
  variables { web_origin = "https://editor.example.com/login" }
  expect_failures = [var.web_origin]
}
