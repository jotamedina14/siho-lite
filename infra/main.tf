# SIHO Lite: infraestructura del prototipo en AWS (us-east-1).
# Todo se crea con `terraform apply` y se elimina con `terraform destroy`.

terraform {
  required_version = ">= 1.9"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
  # Estado local (no se versiona: ver .gitignore). Suficiente para un proyecto individual.
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Proyecto    = "SIHO-Lite"
      Ambiente    = "prototipo"
      Responsable = "yonathan-lopez"
      Curso       = "ElectivaIII"
    }
  }
}

data "aws_caller_identity" "actual" {}
data "aws_availability_zones" "disponibles" { state = "available" }

resource "random_id" "sufijo" { byte_length = 3 }

locals {
  nombre = "siho-lite"
  azs    = slice(data.aws_availability_zones.disponibles.names, 0, 2)
  cuenta = data.aws_caller_identity.actual.account_id
}
