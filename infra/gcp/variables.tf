variable "project_id" {
  type = string
}

variable "billing_account" {
  type = string
}

variable "region" {
  type    = string
  default = "us-central1"

}

variable "zone" {
  type    = string
  default = "us-central1-a"

}

variable "web_origin" {
  type = string
}

variable "snapshots_bucket" {
  type = string
}

variable "results_bucket" {
  type = string
}

variable "backups_bucket" {
  type = string
}

variable "environment" {
  type    = string
  default = "none"
  validation {
    condition     = contains(["none", "vm", "gke"], var.environment)
    error_message = "Select none, vm or gke; never both paid environments."

  }


}

