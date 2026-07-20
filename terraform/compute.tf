data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

# Ubuntu 22.04 for ARM (A1 Flex shape)
data "oci_core_images" "ubuntu_arm" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "22.04"
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
  state                    = "AVAILABLE"
}

resource "oci_core_instance" "main" {
  compartment_id = var.compartment_ocid
  # Try AD index 0 first. If you get "out of capacity", change var.availability_domain to 1 or 2.
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[var.availability_domain].name
  display_name        = "moneytalks"
  shape               = "VM.Standard.A1.Flex"

  shape_config {
    # 2 OCPUs + 12 GB leaves room for future apps (free tier: 4 OCPU / 24 GB total)
    ocpus         = 2
    memory_in_gbs = 12
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu_arm.images[0].id
    boot_volume_size_in_gbs = 50
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.main.id
    assign_public_ip = true
    display_name     = "moneytalks-vnic"
    hostname_label   = "moneytalks"
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data = base64encode(templatefile("${path.module}/cloud-init.sh.tpl", {
      tailscale_auth_key = var.tailscale_auth_key
      app_secret_key     = var.app_secret_key
      plaid_client_id    = var.plaid_client_id
      plaid_secret       = var.plaid_secret
      docker_image       = var.docker_image
      data_device        = "/dev/oracleoci/oraclevdb"
    }))
  }

  timeouts {
    create = "10m"
  }
}

# Separate block volume for data — survives VM recreations
resource "oci_core_volume" "data" {
  compartment_id      = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[var.availability_domain].name
  display_name        = "moneytalks-data"
  size_in_gbs         = 50
}

resource "oci_core_volume_attachment" "data" {
  attachment_type = "paravirtualized"
  instance_id     = oci_core_instance.main.id
  volume_id       = oci_core_volume.data.id
  display_name    = "moneytalks-data-attachment"

  # Prevent data loss — volume must be detached before Terraform will destroy it
  lifecycle {
    prevent_destroy = true
  }
}
