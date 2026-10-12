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
  validation {
    condition     = can(regex("^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$", var.web_origin))
    error_message = "Set an exact HTTPS origin without a path, query, fragment or credentials."
  }
}

variable "budget_start_date" {
  description = "Actual start of the cumulative USD300 learning budget, in YYYY-MM-DD format."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}$", var.budget_start_date)) && can(formatdate("YYYY-MM-DD", "${var.budget_start_date}T00:00:00Z"))
    error_message = "Set budget_start_date to a valid YYYY-MM-DD calendar date; preserve it on later rollouts."
  }
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

