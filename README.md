# Rutas

Planeador de rutas de entrega para Bloobit. Registra empresas con su ubicación verificada y calcula el orden de visita más rápido usando tiempos de manejo reales por calles.

## Qué hace

- **Registrar empresas**: busca por dirección o nombre, pega coordenadas o un link largo de Google Maps, o haz clic en el mapa. El pin se puede arrastrar a la entrada exacta.
- **Verificación de cada ubicación**: al colocar el pin consulta la dirección real del punto y la calle transitable más cercana. Si el pin queda a más de 60 m de una calle avisa para revisarlo; a más de 200 m lo marca como probable error. No se guarda sin confirmar que se revisó el pin.
- **Mejor ruta**: pide a OSRM la matriz de tiempos de manejo entre todos los puntos y resuelve el orden óptimo (exacto hasta 12 paradas; para más usa 2-opt + or-opt). Luego traza la ruta por calles en el mapa.
- **Itinerario**: hora de salida, minutos por entrega, hora estimada de llegada a cada empresa, total de manejo, distancia y hora de término. Opción de regresar o no a la oficina.
- **Navegación**: botón para abrir la ruta completa en Google Maps (en tramos de 9 paradas si son más). Cada parada del itinerario tiene «Ir con Waze» y «Google Maps» para navegar tramo por tramo.
- **Respaldo**: Exportar / Importar todas las empresas en JSON.

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html` | Estructura de la página |
| `styles.css` | Tema oscuro azul, sobrio y minimalista |
| `app.js` | Mapa, registro, verificación y cálculo de ruta |
| `solver.js` | Optimizador del orden de paradas |
| `empresas.json` | Lista base que se carga si el navegador no tiene datos |
| `firebase-config.js` | Configuración de Firebase (vacía = sin base de datos) |
| `cloud.js` | Conexión con Firebase: inicio de sesión y Firestore |

## Servicios que usa (gratuitos, sin llave)

- Mapa: OpenStreetMap (el tono oscuro azul se aplica con CSS).
- Tiempos y trazo de ruta: servidor público de OSRM (`router.project-osrm.org`).
- Búsqueda de direcciones: Photon y Nominatim (OpenStreetMap). Se consultan los dos y se ordenan por precisión (número exacto, solo calle o zona).

El servidor público de OSRM es de demostración: para uso diario ligero funciona bien, pero si algún día deja de responder la app calcula con distancias aproximadas y lo avisa.

## Dónde se guardan los datos

Sin Firebase: en el navegador de cada computadora/celular (localStorage). Para pasar las empresas a otro equipo o a un compañero: **Exportar** en uno e **Importar** en el otro.

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

1. La oficina (Puente de Alvarado 303, 20.5933, -100.3726) ya viene precargada. Para moverla: Empresas → Oficina Bloobit → Editar / verificar.
3. Registra cada empresa igual.
4. En **Ruta del día** marca a quién vas hoy → **Calcular mejor ruta**.

> Los links cortos `maps.app.goo.gl` no traen coordenadas; ábrelos primero y copia los números o el link completo.

## Waze

Waze no permite rutas con varias paradas ni optimizar el orden desde un enlace. Por eso la app calcula el orden y Waze se usa para cada tramo: al terminar una entrega, toca «Ir con Waze» en la siguiente parada. Waze elige el camino más rápido de ese tramo con el tráfico del momento.

## Base de datos con Firebase (opcional)

Con Firebase, las empresas quedan en una base de datos compartida: lo que registre una persona lo ven todas al instante, en cualquier equipo. La selección del día y la hora de salida siguen siendo de cada equipo.

1. Entra a https://console.firebase.google.com → **Agregar proyecto** (ej. `rutas-bloobit`). Google Analytics no es necesario.
2. **Compilación → Firestore Database → Crear base de datos** → ubicación `nam5 (us-central)` o la más cercana → modo **producción**.
3. En Firestore → pestaña **Reglas**, pega esto y **Publicar**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /empresas/{id} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```

4. **Compilación → Authentication → Comenzar** → en *Método de acceso* habilita **Correo electrónico/contraseña**.
5. En Authentication → **Usuarios → Agregar usuario**: crea una cuenta para cada persona que usará la app. Solo ellas podrán entrar.
6. En Authentication → **Configuración → Dominios autorizados** agrega el dominio de Vercel (ej. `rutas-xxxx.vercel.app`).
7. **Configuración del proyecto** (engrane) → *Tus apps* → ícono **Web `</>`** → registra la app → copia el objeto `firebaseConfig`.
8. Pégalo en `firebase-config.js` en lugar de `null`:

   ```js
   window.FIREBASE_CONFIG = { apiKey: "...", authDomain: "...", projectId: "...", storageBucket: "...", messagingSenderId: "...", appId: "..." };
   ```

9. Commit y push. Vercel publica solo. Al abrir la página pedirá correo y contraseña.

La primera persona que entre con empresas ya guardadas en su navegador las sube automáticamente si la base de datos está vacía. Los valores de `firebaseConfig` no son secretos; la protección la dan el inicio de sesión y las reglas.
