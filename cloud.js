/*
 * Conexión opcional con Firebase (Authentication + Firestore).
 * Solo se activa si firebase-config.js trae una configuración válida.
 * Expone window.RutasCloud o null.
 */
(function () {
  "use strict";
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey || !cfg.projectId) { window.RutasCloud = null; return; }

  const BASE = "https://www.gstatic.com/firebasejs/10.12.2/";
  let auth, db, col;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("no se pudo cargar Firebase"));
      document.head.appendChild(s);
    });
  }

  function friendly(e) {
    const code = (e && e.code) || "";
    const map = {
      "auth/invalid-credential": "Correo o contraseña incorrectos.",
      "auth/invalid-login-credentials": "Correo o contraseña incorrectos.",
      "auth/wrong-password": "Correo o contraseña incorrectos.",
      "auth/user-not-found": "Ese correo no tiene acceso. Pide que te den de alta.",
      "auth/invalid-email": "El correo no es válido.",
      "auth/too-many-requests": "Demasiados intentos. Espera unos minutos.",
      "auth/network-request-failed": "Sin conexión a internet.",
      "permission-denied": "Tu usuario no tiene permiso para esta base de datos. Revisa las reglas de Firestore."
    };
    return map[code] || (e && e.message) || "Error desconocido";
  }

  window.RutasCloud = {
    async init() {
      await loadScript(BASE + "firebase-app-compat.js");
      await Promise.all([loadScript(BASE + "firebase-auth-compat.js"), loadScript(BASE + "firebase-firestore-compat.js")]);
      firebase.initializeApp(cfg);
      auth = firebase.auth();
      db = firebase.firestore();
      col = db.collection(window.FIREBASE_COLLECTION || "empresas");
    },
    onAuth(fn) { return auth.onAuthStateChanged(fn); },
    signIn(email, pass) { return auth.signInWithEmailAndPassword(email, pass); },
    resetPassword(email) { return auth.sendPasswordResetEmail(email); },
    signOut() { return auth.signOut(); },
    user() { return auth && auth.currentUser; },
    // Escucha la colección en vivo; fn(lista, esPrimeraCarga)
    subscribe(fn, onError) {
      let first = true;
      return col.onSnapshot((snap) => {
        fn(snap.docs.map((d) => Object.assign({ id: d.id }, d.data())), first);
        first = false;
      }, onError);
    },
    // Guarda cambios y borrados en lotes (Firestore admite 500 operaciones por lote)
    async write(upserts, deletes) {
      const ops = upserts.map((p) => ["set", p]).concat(deletes.map((id) => ["del", id]));
      for (let i = 0; i < ops.length; i += 450) {
        const batch = db.batch();
        for (const [kind, v] of ops.slice(i, i + 450)) {
          if (kind === "set") { const { id, ...rest } = v; batch.set(col.doc(id), JSON.parse(JSON.stringify(rest))); }
          else batch.delete(col.doc(v));
        }
        await batch.commit();
      }
    },
    friendly
  };
})();
