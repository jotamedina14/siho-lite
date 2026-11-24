# Costo real de SIHO Lite (AWS Cost Explorer)

Consulta hecha el 23 de noviembre de 2026 con `aws ce get-cost-and-usage` (costo sin mezclar, `UnblendedCost`). Cost Explorer tiene hasta 24 h de retraso: los datos llegan hasta la mañana del 23 de noviembre (hora UTC).

## Resumen

| Concepto | Valor |
|---|---|
| Encendido | Desde el 16 de noviembre de 2026 (tarde). Destruido el 23 de noviembre de 2026 (21:07, hora Colombia) |
| Costo de SIHO Lite del 16 al 23 de noviembre | **≈ USD 16,25** |
| Costo diario en estado estable (2 tareas, 17 a 22 de noviembre) | **USD 2,49 por día** |
| Equivalente mensual | ≈ USD 75 al mes (lo estimado eran USD 80: 7 % menos) |
| Pagado con créditos de la cuenta | 100 % (costo neto: **USD 0**) |
| Frente a la arquitectura de producción de la Actividad 4 (USD 1.732,78 al mes) | El prototipo cuesta alrededor del 4 % |

## Por servicio (16 a 23 de noviembre)

| Servicio | USD | Comentario |
|---|---|---|
| ECS sobre Fargate | 4,20 | 2 tareas de 0,25 vCPU y 0,5 GB (hasta 6 durante la prueba de carga) |
| Application Load Balancer | 3,54 | Hora del balanceador más LCU bajas |
| IPv4 públicas (VPC) | 3,27 | Balanceador y tareas. Es el precio de no usar NAT Gateway, que costaría unos USD 32 al mes |
| RDS PostgreSQL (db.t4g.micro, 20 GB) | 2,98 | Single-AZ |
| AWS WAF | 2,00 | Web ACL más 4 reglas |
| Secrets Manager | 0,26 | 2 secretos |
| CloudFront, S3, ECR, CloudWatch, Cognito, SNS | < 0,01 | Capas gratuitas |
| **Total SIHO Lite** | **≈ 16,25** | |

Lo estimado en el diseño era USD 2,7 por día; lo real fue USD 2,49 por día. El día de la prueba de carga (6 tareas durante cerca de una hora) casi no movió la cifra.

## Gasto de la cuenta que no es del proyecto

De los USD 25,50 de uso de noviembre en la cuenta, unos USD 9,25 son de recursos anteriores a SIHO Lite: la instancia EC2 `rag-tunnel` (t3.micro con IP pública y disco, ≈ USD 0,39 por día) y una zona de Route 53 (USD 0,50 al mes). Todo quedó cubierto por los créditos.

## Lección aprendida: el presupuesto que no avisó

El presupuesto `SIHO-Lite-20USD` nunca envió alertas, aunque se gastaron unos USD 16. La causa es que, por defecto, AWS Budgets **descuenta los créditos** (`IncludeCredit = true`): el gasto neto quedó en USD 0, y el presupuesto solo registró un pronóstico de USD 22,99. En cambio, otro presupuesto de la cuenta, anterior al proyecto, mide el costo sin créditos y sí superó su límite de USD 5. Conclusión: en una cuenta con créditos, para vigilar cuánto se consume hay que desmarcar "incluir créditos" en el presupuesto.
