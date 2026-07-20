output "public_ip" {
  value       = oci_core_instance.main.public_ip
  description = "Public IP — used only for initial SSH setup. Not needed once Tailscale is running."
}

output "ssh_command" {
  value       = "ssh ubuntu@${oci_core_instance.main.public_ip}"
  description = "SSH command for initial connection"
}

output "tailscale_url" {
  value       = "https://moneytalks.YOUR-TAILNET.ts.net"
  description = "App URL via Tailscale — replace YOUR-TAILNET with your actual tailnet name from tailscale.com/admin"
}

output "data_volume_ocid" {
  value       = oci_core_volume.data.id
  description = "OCID of the data block volume — keep this safe, it's your data"
}
