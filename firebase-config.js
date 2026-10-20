/*
 * Configuración de Firebase (opcional).
 *
 * Mientras FIREBASE_CONFIG sea null, la app guarda las empresas solo en el navegador.
 * Para usar la base de datos compartida, pega aquí el objeto firebaseConfig de tu proyecto
 * (Consola de Firebase → Configuración del proyecto → Tus apps → Web → firebaseConfig).
 * Estos valores no son secretos: la seguridad la dan el inicio de sesión y las reglas de Firestore.
 *
 * Ejemplo:
 * window.FIREBASE_CONFIG = {
 *   apiKey: "AIza...",
 *   authDomain: "rutas-bloobit.firebaseapp.com",
 *   projectId: "rutas-bloobit",
 *   storageBucket: "rutas-bloobit.appspot.com",
 *   messagingSenderId: "1234567890",
 *   appId: "1:1234567890:web:abc123"
 * };
 */
window.FIREBASE_CONFIG = null;

// Colección de Firestore donde se guardan las empresas
window.FIREBASE_COLLECTION = "empresas";
