variable "region" {
  description = "Región de AWS (la misma de la Actividad 4)"
  type        = string
  default     = "us-east-1"
}

variable "correo_alertas" {
  description = "Correo que recibe las alarmas de CloudWatch (hay que confirmar la suscripción)"
  type        = string
}

variable "image_tag" {
  description = "Etiqueta de la imagen de la API en ECR con la que se crea la primera definición de tarea"
  type        = string
}

variable "ips_prueba_carga" {
  description = "CIDR desde donde se lanza Locust; se excluyen de la regla de límite de tasa del WAF"
  type        = list(string)
  default     = []
}

variable "tareas_min" {
  type    = number
  default = 2
}

variable "tareas_max" {
  type    = number
  default = 6
}

variable "objetivo_cpu" {
  description = "CPU promedio objetivo del servicio para el target tracking (%)"
  type        = number
  default     = 60
}

variable "objetivo_solicitudes_por_tarea" {
  description = "Solicitudes por minuto por tarea (ALBRequestCountPerTarget) objetivo"
  type        = number
  default     = 300
}
