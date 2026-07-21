output "public_ip" {
  value       = try(oci_core_instance.main.public_ip, "YOUR_SERVER_IP")
  description = "E2.1.Micro (live) public IP"
}

output "ssh_command" {
  value       = oci_core_instance.main.public_ip != null ? "ssh opc@${oci_core_instance.main.public_ip}" : "ssh opc@YOUR_SERVER_IP"
  description = "SSH into live E2.1.Micro"
}

output "arm_public_ip" {
  value       = oci_core_instance.arm.public_ip
  description = "A1.Flex public IP (available once provisioned)"
}

output "arm_ssh_command" {
  value       = oci_core_instance.arm.public_ip != null ? "ssh opc@${oci_core_instance.arm.public_ip}" : "not yet provisioned"
  description = "SSH into A1.Flex once provisioned"
}

output "data_volume_ocid" {
  value       = oci_core_volume.data.id
  description = "OCID of the data block volume"
}

output "tailscale_url" {
  value       = "https://moneytalks.YOUR-TAILNET.ts.net"
  description = "App URL via Tailscale — replace YOUR-TAILNET with your actual tailnet name from tailscale.com/admin"
}
