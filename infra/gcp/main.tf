locals {
  labels = {
    application = "text-editor", purpose = "learning", budget = "usd300"
  }

}

resource "google_project_service" "apis" {

  for_each           = toset(["compute.googleapis.com", "container.googleapis.com", "storage.googleapis.com", "artifactregistry.googleapis.com", "secretmanager.googleapis.com", "iamcredentials.googleapis.com", "logging.googleapis.com", "billingbudgets.googleapis.com"])
  project            = var.project_id
  service            = each.key
  disable_on_destroy = false

}

resource "google_billing_budget" "learning" {

  billing_account = var.billing_account
  display_name    = "Text editor TOTAL learning budget USD300"
  budget_filter {
    projects = ["projects/${data.google_project.lab.number}"]
    custom_period {
      start_date {
        year  = 2026
        month = 10
        day   = 4
      }
    }

  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = "300"

    }


  }

  threshold_rules {
    threshold_percent = 0.333333
  }

  threshold_rules {
    threshold_percent = 0.6
  }

  threshold_rules {
    threshold_percent = 0.766667
  }

  threshold_rules {
    threshold_percent = 0.8
    spend_basis       = "FORECASTED_SPEND"

  }


}

data "google_project" "lab" {
  project_id = var.project_id
}

resource "google_artifact_registry_repository" "editor" {

  location      = var.region
  repository_id = "editor"
  format        = "DOCKER"
  labels        = local.labels
  depends_on    = [google_project_service.apis]

}

resource "google_storage_bucket" "snapshots" {

  name                        = var.snapshots_bucket
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels
  soft_delete_policy {
    retention_duration_seconds = 0
  }

  cors {
    origin          = [var.web_origin]
    method          = ["PUT", "GET", "HEAD"]
    response_header = ["Content-Type", "Content-Length", "Content-Range", "Range", "ETag"]
    max_age_seconds = 3600

  }

  # No age lifecycle: version references decide snapshot retirement.

}

resource "google_storage_bucket" "results" {

  name                        = var.results_bucket
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels
  soft_delete_policy {
    retention_duration_seconds = 0
  }

  # Reference-aware worker GC handles the 24-hour result lifetime.

}

resource "google_storage_bucket" "backups" {

  name                        = var.backups_bucket
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels
  soft_delete_policy {
    retention_duration_seconds = 604800
  }

  lifecycle_rule {
    condition {
      age = 14
    }

    action {
      type = "Delete"
    }


  }


}

resource "google_service_account" "runtime" {

  for_each     = toset(["document", "processing", "identity", "vm", "node", "ci"])
  account_id   = "editor-${each.key}"
  display_name = "Editor ${each.key} lab account"

}

resource "google_storage_bucket_iam_member" "document" {

  bucket = google_storage_bucket.snapshots.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.runtime["document"].email}"

}

resource "google_storage_bucket_iam_member" "processing_read" {

  bucket = google_storage_bucket.snapshots.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.runtime["processing"].email}"

}

resource "google_storage_bucket_iam_member" "processing_write" {

  bucket = google_storage_bucket.results.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.runtime["processing"].email}"

}

resource "google_storage_bucket_iam_member" "vm" {

  for_each   = toset([var.snapshots_bucket, var.results_bucket, var.backups_bucket])
  bucket     = each.key
  role       = "roles/storage.objectUser"
  member     = "serviceAccount:${google_service_account.runtime["vm"].email}"
  depends_on = [google_storage_bucket.snapshots, google_storage_bucket.results, google_storage_bucket.backups]

}

resource "google_project_iam_member" "node_metrics" {

  for_each = toset(["roles/logging.logWriter", "roles/monitoring.metricWriter", "roles/artifactregistry.reader"])
  project  = var.project_id
  role     = each.key
  member   = "serviceAccount:${google_service_account.runtime["node"].email}"

}

resource "google_project_iam_member" "vm_pull" {

  project = var.project_id
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${google_service_account.runtime["vm"].email}"

}

resource "google_artifact_registry_repository_iam_member" "ci" {

  location   = var.region
  repository = google_artifact_registry_repository.editor.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.runtime["ci"].email}"

}

resource "google_compute_network" "lab" {
  name                    = "editor-lab"
  auto_create_subnetworks = false

}

resource "google_compute_subnetwork" "lab" {

  name                     = "editor-lab"
  network                  = google_compute_network.lab.id
  ip_cidr_range            = "10.42.0.0/24"
  region                   = var.region
  private_ip_google_access = true
  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.43.0.0/16"

  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.44.0.0/20"

  }


}

resource "google_compute_firewall" "https" {

  name          = "editor-https"
  network       = google_compute_network.lab.name
  target_tags   = ["editor-web"]
  source_ranges = ["0.0.0.0/0"]
  allow {
    protocol = "tcp"
    ports    = ["80", "443"]

  }


}

resource "google_compute_firewall" "iap" {

  name          = "editor-iap"
  network       = google_compute_network.lab.name
  target_tags   = ["editor-web"]
  source_ranges = ["35.235.240.0/20"]
  allow {
    protocol = "tcp"
    ports    = ["22"]

  }


}

resource "google_compute_instance" "vm" {

  count        = var.environment == "vm" ? 1 : 0
  name         = "editor-lab"
  machine_type = "e2-standard-2"
  tags         = ["editor-web"]
  labels       = local.labels
  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
      size  = 50
      type  = "pd-balanced"

    }


  }

  network_interface {
    subnetwork = google_compute_subnetwork.lab.id
    access_config {

    }


  }

  service_account {
    email  = google_service_account.runtime["vm"].email
    scopes = ["cloud-platform"]

  }

  metadata = {
    enable-oslogin = "TRUE"
  }

  deletion_protection = true

}

resource "google_container_cluster" "lab" {

  count               = var.environment == "gke" ? 1 : 0
  name                = "editor-lab"
  location            = var.zone
  initial_node_count  = 1
  network             = google_compute_network.lab.id
  subnetwork          = google_compute_subnetwork.lab.id
  deletion_protection = true
  release_channel {
    channel = "REGULAR"
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"

  }

  network_policy {
    enabled  = true
    provider = "CALICO"

  }

  node_config {

    machine_type    = "e2-standard-2"
    disk_size_gb    = 50
    disk_type       = "pd-balanced"
    service_account = google_service_account.runtime["node"].email
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]
    workload_metadata_config {
      mode = "GKE_METADATA"
    }

    labels = local.labels

  }

  depends_on = [google_project_service.apis]

}

resource "google_service_account_iam_member" "workload" {

  for_each           = toset(["identity", "document", "processing"])
  service_account_id = google_service_account.runtime[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[editor-lab/${each.key}-service]"

}

output "runtime_accounts" {
  value = {
    for k, v in google_service_account.runtime : k => v.email
  }

}

output "registry" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/editor"
}

