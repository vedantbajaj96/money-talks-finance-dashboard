data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

# ── AMD image (E2.1.Micro) ────────────────────────────────────────
data "oci_core_images" "oracle_linux_amd" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Oracle Linux"
  operating_system_version = "9"
  shape                    = "VM.Standard.E2.1.Micro"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
  state                    = "AVAILABLE"
}

# ── ARM image (A1.Flex) ───────────────────────────────────────────
data "oci_core_images" "oracle_linux_arm" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Oracle Linux"
  operating_system_version = "9"
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
  state                    = "AVAILABLE"
}

# ── Current live instance (E2.1.Micro, YOUR_SERVER_IP) ───────────
# ignore_changes = all so terraform never tries to recreate or modify it.
# Import with: terraform import oci_core_instance.main <instance-ocid>
resource "oci_core_instance" "main" {
  compartment_id      = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[var.availability_domain].name
  display_name        = "moneytalks"
  shape               = "VM.Standard.E2.1.Micro"

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.oracle_linux_amd.images[0].id
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

  lifecycle {
    ignore_changes = all
  }
}

# ── A1.Flex ARM instance (4 OCPUs / 24 GB — Always Free) ─────────
# Provisioned alongside the live E2.1.Micro; data volume migrates over
# once this instance is confirmed healthy.
resource "oci_core_instance" "arm" {
  compartment_id      = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[var.availability_domain].name
  display_name        = "moneytalks-arm"
  shape               = "VM.Standard.A1.Flex"

  shape_config {
    ocpus         = 4
    memory_in_gbs = 24
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.oracle_linux_arm.images[0].id
    boot_volume_size_in_gbs = 50
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.main.id
    assign_public_ip = true
    display_name     = "moneytalks-arm-vnic"
    hostname_label   = "moneytalks-arm"
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
    create = "20m"
  }
}

# ── Data block volume (survives VM recreations) ───────────────────
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

  lifecycle {
    prevent_destroy = true
    ignore_changes  = all
  }
}
