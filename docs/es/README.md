# Documentación de HR-Core

[English](../en/README.md)

HR-Core es una aplicación de control horario, ausencias, gastos y documentos para empresas, que se instala en un
servidor propio. Esta guía explica cómo instalarla, ponerla a disposición de la plantilla, adaptarla a tu empresa
y mantenerla.

## Elige cómo instalarlo

| Quiero… | Guía |
|---|---|
| Probarlo en mi ordenador en 5 minutos | [Inicio rápido](inicio-rapido.md) |
| Instalarlo en un servidor en la nube (VPS) | [Instalar en un VPS](vps.md) |
| Que la plantilla entre desde cualquier sitio con `https://fichajes.miempresa.es` | [Con dominio y HTTPS](dominio.md) |
| Que solo se pueda entrar desde los dispositivos de la empresa, sin exponer nada a internet | [Red privada con Tailscale](tailscale.md) |

### ¿Dominio o Tailscale?

| | Con dominio | Con Tailscale |
|---|---|---|
| Cómo entra la plantilla | Desde cualquier navegador, con su correo y contraseña | Solo desde dispositivos con Tailscale y dentro de tu red |
| Qué necesitas | Un dominio y un servidor con los puertos 80 y 443 abiertos | Una cuenta de Tailscale (tiene plan gratuito para equipos pequeños; revisa sus precios según cuántas personas seáis) |
| Exposición a internet | La app es pública (protegida por contraseña) | Ninguna: el servidor no abre puertos |
| Instalar la app en el móvil, GPS, cámara y avisos | Sí | Sí (Tailscale pone HTTPS) |
| Ideal para | Plantillas que fichan desde obras, rutas o su propio móvil | Equipos pequeños o con datos especialmente sensibles |

## Después de instalar

- [Personalizar](personalizar.md): nombre, logotipo, colores, datos legales, correo, jornada, privacidad.
- [Gestionar](gestionar.md): dar de alta a la plantilla, copias de seguridad y restauración, actualizar, registros,
  mover a otro servidor.
- [Problemas frecuentes](problemas.md).
- [Opciones avanzadas](avanzado.md): publicar bajo una ruta, tu propio nginx, almacenamiento S3, todas las variables.
- [Desarrollo y arquitectura](desarrollo.md).
- Manuales de uso en PDF con capturas, para repartir: [trabajadores](../manuales/manual-trabajadores.pdf),
  [responsables](../manuales/manual-responsables.pdf) y [administración](../manuales/manual-administracion.pdf).

## Requisitos del servidor

| Plantilla | CPU | Memoria | Disco |
|---|---|---|---|
| Hasta 50 personas | 2 vCPU | 4 GB | 40 GB SSD |
| Hasta 200 personas | 4 vCPU | 8 GB | 80 GB SSD |

Linux de 64 bits (Ubuntu Server 24.04 o Debian 12 recomendados) con Docker. Se publican imágenes para procesadores
x86 (amd64) y ARM (arm64).

## Aviso legal

HR-Core incluye textos base de privacidad y aviso legal pensados para España (RGPD, LOPDGDD y el registro de
jornada del Estatuto de los Trabajadores). Son un punto de partida: **revísalos con tu asesoría** antes de usar la
aplicación con tu plantilla. Quien instala HR-Core es responsable del tratamiento de los datos de su empresa.

¿Prefieres no ocuparte de nada de esto? [ARcode](https://arcode.es/HR-core/) ofrece HR-Core gestionado:
instalación, servidor, copias, actualizaciones y soporte.
