# Rutas

Planeador de rutas de entrega para Bloobit. Registra empresas con su ubicación verificada y calcula el orden de visita más rápido usando tiempos de manejo reales por calles.

## Qué hace

- **Registrar empresas**: busca por dirección o nombre, pega coordenadas o un link largo de Google Maps, o haz clic en el mapa. El pin se puede arrastrar a la entrada exacta.
- **Verificación de cada ubicación**: al colocar el pin consulta la dirección real del punto y la calle transitable más cercana. Si el pin queda a más de 60 m de una calle avisa para revisarlo; a más de 200 m lo marca como probable error. No se guarda sin confirmar que se revisó el pin.
- **Mejor ruta**: pide a OSRM la matriz de tiempos de manejo entre todos los puntos y resuelve el orden óptimo (exacto hasta 12 paradas; para más usa 2-opt + or-opt). Luego traza la ruta por calles en el mapa.
- **Itinerario**: hora de salida, minutos por entrega, hora estimada de llegada a cada empresa, total de manejo, distancia y hora de término. Opción de regresar o no a la oficina.
- **Navegación**: botón para abrir la ruta completa en Google Maps (en tramos de 9 paradas si son más) y la primera parada en Waze.
- **Respaldo**: Exportar / Importar todas las empresas en JSON.

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html` | Estructura de la página |
| `styles.css` | Tema oscuro azul, sobrio y minimalista |
| `app.js` | Mapa, registro, verificación y cálculo de ruta |
| `solver.js` | Optimizador del orden de paradas |
| `empresas.json` | Lista base que se carga si el navegador no tiene datos |

## Servicios que usa (gratuitos, sin llave)

- Mapa: OpenStreetMap (el tono oscuro azul se aplica con CSS).
- Tiempos y trazo de ruta: servidor público de OSRM (`router.project-osrm.org`).
- Búsqueda de direcciones: Photon y Nominatim (OpenStreetMap). Se consultan los dos y se ordenan por precisión (número exacto, solo calle o zona).

El servidor público de OSRM es de demostración: para uso diario ligero funciona bien, pero si algún día deja de responder la app calcula con distancias aproximadas y lo avisa.

## Dónde se guardan los datos

En el navegador de cada computadora/celular (localStorage). Para pasar las empresas a otro equipo o a un compañero: **Exportar** en uno e **Importar** en el otro.

Para que cualquiera que abra la página ya tenga la lista: exporta el JSON, renómbralo a `empresas.json`, reemplaza el de este repositorio y haz commit. Vercel vuelve a publicar solo.

## Publicar en Vercel

1. Entra a https://vercel.com e inicia sesión con tu cuenta de GitHub.
2. **Add New… → Project**.
3. En la lista de repositorios elige **carlossbel/Rutas** → **Import** (si no aparece, da clic en *Adjust GitHub App Permissions* y dale acceso al repo).
4. Configuración:
   - Framework Preset: **Other**
   - Root Directory: `./`
   - Build Command: vacío
   - Output Directory: vacío
5. **Deploy**. En menos de un minuto te da la URL (algo como `rutas-xxxx.vercel.app`).
6. Cada `git push` a `main` vuelve a publicar automáticamente.

## Primer uso

1. Abre la página: como no hay oficina, entra directo a **Registrar**.
2. Pega las coordenadas de la oficina (en Google Maps mantén presionado el lugar y copia los números), revisa el pin, marca **Esta es la oficina** y la casilla de confirmación → **Guardar**.
3. Registra cada empresa igual.
4. En **Ruta del día** marca a quién vas hoy → **Calcular mejor ruta**.

> Los links cortos `maps.app.goo.gl` no traen coordenadas; ábrelos primero y copia los números o el link completo.
