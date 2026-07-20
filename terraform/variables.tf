variable "tenancy_ocid" {
  description = "OCI Tenancy OCID — Profile > Tenancy in the console"
}

variable "user_ocid" {
  description = "Your user OCID — Profile > My profile in the console"
}

variable "fingerprint" {
  description = "API key fingerprint — Profile > API keys"
}

variable "private_key_path" {
  description = "Local path to your OCI API private key (e.g. ~/.oci/oci_api_key.pem)"
}

variable "region" {
  description = "OCI region (e.g. us-ashburn-1, ap-sydney-1)"
  default     = "us-ashburn-1"
}

variable "compartment_ocid" {
  description = "Compartment OCID — use tenancy_ocid to deploy into the root compartment"
}

variable "availability_domain" {
  description = "Availability domain index (0, 1, or 2). If you get 'out of capacity', try a different index."
  default     = 0
}

variable "ssh_public_key" {
  description = "SSH public key content (paste the full key, e.g. contents of ~/.ssh/id_ed25519.pub)"
}

variable "tailscale_auth_key" {
  description = "Tailscale one-time auth key — generate at tailscale.com/settings/keys"
  sensitive   = true
}

variable "app_secret_key" {
  description = "Random secret for session cookies — run: openssl rand -hex 32"
  sensitive   = true
}

variable "plaid_client_id" {
  description = "Plaid client ID"
  sensitive   = true
  default     = ""
}

variable "plaid_secret" {
  description = "Plaid secret key"
  sensitive   = true
  default     = ""
}

variable "docker_image" {
  description = "Docker image to pull on the server"
  default     = "vedantbajaj96/moneytalks:latest"
}
