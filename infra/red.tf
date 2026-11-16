# Red: VPC propia en 2 zonas. Subredes públicas para el ALB y las tareas (con IP pública,
# así no se paga NAT Gateway) y subredes privadas sin salida a internet para RDS.

resource "aws_vpc" "principal" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${local.nombre}-vpc" }
}

resource "aws_internet_gateway" "principal" {
  vpc_id = aws_vpc.principal.id
  tags   = { Name = "${local.nombre}-igw" }
}

resource "aws_subnet" "publica" {
  count                   = 2
  vpc_id                  = aws_vpc.principal.id
  cidr_block              = cidrsubnet(aws_vpc.principal.cidr_block, 8, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = false
  tags                    = { Name = "${local.nombre}-publica-${local.azs[count.index]}" }
}

resource "aws_subnet" "privada" {
  count             = 2
  vpc_id            = aws_vpc.principal.id
  cidr_block        = cidrsubnet(aws_vpc.principal.cidr_block, 8, count.index + 10)
  availability_zone = local.azs[count.index]
  tags              = { Name = "${local.nombre}-privada-${local.azs[count.index]}" }
}

resource "aws_route_table" "publica" {
  vpc_id = aws_vpc.principal.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.principal.id
  }
  tags = { Name = "${local.nombre}-rt-publica" }
}

resource "aws_route_table_association" "publica" {
  count          = 2
  subnet_id      = aws_subnet.publica[count.index].id
  route_table_id = aws_route_table.publica.id
}

# Tabla privada sin ruta a internet: la base de datos no es alcanzable desde fuera de la VPC.
resource "aws_route_table" "privada" {
  vpc_id = aws_vpc.principal.id
  tags   = { Name = "${local.nombre}-rt-privada" }
}

resource "aws_route_table_association" "privada" {
  count          = 2
  subnet_id      = aws_subnet.privada[count.index].id
  route_table_id = aws_route_table.privada.id
}

# Grupos de seguridad encadenados: CloudFront -> ALB -> tareas -> RDS.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "${local.nombre}-alb"
  description = "ALB: solo acepta trafico de CloudFront"
  vpc_id      = aws_vpc.principal.id
  tags        = { Name = "${local.nombre}-alb" }
}

resource "aws_vpc_security_group_ingress_rule" "alb_desde_cloudfront" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP solo desde los nodos de origen de CloudFront"
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "alb_a_tareas" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Hacia las tareas de la API"
  referenced_security_group_id = aws_security_group.tareas.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

resource "aws_security_group" "tareas" {
  name        = "${local.nombre}-tareas"
  description = "Tareas Fargate: solo aceptan trafico del ALB"
  vpc_id      = aws_vpc.principal.id
  tags        = { Name = "${local.nombre}-tareas" }
}

resource "aws_vpc_security_group_ingress_rule" "tareas_desde_alb" {
  security_group_id            = aws_security_group.tareas.id
  description                  = "Puerto de la API desde el ALB"
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

resource "aws_vpc_security_group_egress_rule" "tareas_https" {
  security_group_id = aws_security_group.tareas.id
  description       = "HTTPS hacia ECR, Secrets Manager, S3, CloudWatch y Cognito"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "tareas_a_rds" {
  security_group_id            = aws_security_group.tareas.id
  description                  = "PostgreSQL hacia RDS"
  referenced_security_group_id = aws_security_group.rds.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_security_group" "rds" {
  name        = "${local.nombre}-rds"
  description = "RDS: solo acepta conexiones de las tareas"
  vpc_id      = aws_vpc.principal.id
  tags        = { Name = "${local.nombre}-rds" }
}

resource "aws_vpc_security_group_ingress_rule" "rds_desde_tareas" {
  security_group_id            = aws_security_group.rds.id
  description                  = "PostgreSQL desde las tareas de la API"
  referenced_security_group_id = aws_security_group.tareas.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
