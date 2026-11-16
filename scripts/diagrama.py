"""Diagrama de arquitectura de SIHO Lite con los íconos oficiales de AWS (librería diagrams).

Requiere Graphviz (`sudo apt install graphviz`). Uso: .venv/bin/python scripts/diagrama.py
Genera docs/arquitectura.png
"""

from pathlib import Path

from diagrams import Cluster, Diagram, Edge
from diagrams.aws.compute import ECR, Fargate
from diagrams.aws.database import RDSPostgresqlInstance
from diagrams.aws.management import AutoScaling, Cloudwatch, CloudwatchAlarm
from diagrams.aws.network import CloudFront, ElbApplicationLoadBalancer
from diagrams.aws.security import Cognito, SecretsManager, WAF
from diagrams.aws.storage import SimpleStorageServiceS3Bucket
from diagrams.aws.general import Users
from diagrams.aws.integration import SNS
from diagrams.aws.cost import Budgets

SALIDA = Path(__file__).resolve().parent.parent / "docs" / "arquitectura"

atributos = {"fontsize": "20", "fontname": "Helvetica", "bgcolor": "white", "pad": "0.4", "splines": "spline", "nodesep": "0.7", "ranksep": "1.0"}
nodo = {"fontsize": "12", "fontname": "Helvetica"}
arista = {"fontsize": "11", "fontname": "Helvetica", "color": "#52514e"}

with Diagram("SIHO Lite en AWS (us-east-1)", filename=str(SALIDA), show=False, direction="LR",
             graph_attr=atributos, node_attr=nodo, edge_attr=arista):
    usuarios = Users("Admisiones, médicos\ny administradores")
    cognito = Cognito("Cognito\nUser Pool + MFA TOTP\ngrupos por rol")

    with Cluster("Borde (global)"):
        waf = WAF("AWS WAF\nreglas administradas\n+ límite de tasa")
        cdn = CloudFront("CloudFront\nHTTPS")

    frontend = SimpleStorageServiceS3Bucket("S3 frontend\nprivado (OAC)")

    with Cluster("VPC 10.20.0.0/16 · 2 zonas de disponibilidad"):
        with Cluster("Subredes públicas"):
            alb = ElbApplicationLoadBalancer("ALB\nleast outstanding\nrequests")
            with Cluster("ECS Fargate · 2 a 6 tareas"):
                tareas = [Fargate("Tarea AZ-a"), Fargate("Tarea AZ-b"), Fargate("Tareas extra\n(autoescalado)")]
        with Cluster("Subredes privadas (sin internet)"):
            rds = RDSPostgresqlInstance("RDS PostgreSQL 16\ncifrada · TLS forzado")

    documentos = SimpleStorageServiceS3Bucket("S3 documentos clínicos\nSSE-KMS · versionado")
    secretos = SecretsManager("Secrets Manager")
    ecr = ECR("ECR\nescaneo de imágenes")

    with Cluster("Operación"):
        cw = Cloudwatch("CloudWatch\nlogs · métricas\ndashboard")
        escalado = AutoScaling("Application Auto Scaling\nCPU 60 % · solicitudes\n+ 6:15 a. m.")
        alarmas = CloudwatchAlarm("Alarmas")
        sns = SNS("SNS → correo")
        presupuesto = Budgets("AWS Budgets\nUSD 20")

    usuarios >> Edge(label="HTTPS") >> cdn
    usuarios >> Edge(label="login", style="dashed") >> cognito
    waf - Edge(style="dotted") - cdn
    cdn >> Edge(label="/*") >> frontend
    cdn >> Edge(label="/api/* + X-Origin-Verify") >> alb
    alb >> tareas
    tareas[1] >> Edge(label="TLS 5432") >> rds
    tareas[1] >> Edge(label="URL prefirmadas", style="dashed") >> documentos
    tareas[0] >> Edge(style="dashed") >> secretos
    ecr >> Edge(style="dashed", label="imagen") >> tareas[2]
    tareas[2] >> Edge(style="dashed") >> cw
    cw >> escalado >> Edge(label="desiredCount", style="dashed") >> tareas[2]
    cw >> alarmas >> sns

print(f"Diagrama generado: {SALIDA}.png")
