# Configurar Firebase — Flujo de Fondos Agropecuario

## Paso 1 — Crear proyecto Firebase

1. Ir a https://console.firebase.google.com
2. Click en **"Agregar proyecto"**
3. Nombre: `flujo-fondos-agro`
4. Desactivar Google Analytics (no es necesario)
5. Click en **"Crear proyecto"**

---

## Paso 2 — Activar Firestore (base de datos)

1. En el menú izquierdo: **Firestore Database**
2. Click en **"Crear base de datos"**
3. Elegir **"Comenzar en modo producción"**
4. Región: `southamerica-east1` (São Paulo, la más cercana a Argentina)
5. Click en **"Listo"**

### Reglas de seguridad Firestore
En **Firestore → Reglas**, reemplazar el contenido con:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /flujo/{document} {
      // Cualquiera puede leer
      allow read: if true;
      // Solo usuarios autenticados pueden escribir
      allow write: if request.auth != null;
    }
  }
}
```

Click en **"Publicar"**.

---

## Paso 3 — Activar Authentication

1. En el menú izquierdo: **Authentication**
2. Click en **"Comenzar"**
3. Pestaña **"Sign-in method"**
4. Activar **"Correo electrónico/contraseña"** → Habilitar → Guardar

### Crear usuarios
En **Authentication → Users → Agregar usuario**:
- Email: `tu@email.com` — tu cuenta
- Email: `contador@email.com` — tu contador
- (Crear las contraseñas que quieras)

---

## Paso 4 — Obtener las credenciales de la app

1. En la pantalla principal del proyecto, click en el ícono **`</>`** (Web)
2. Nombre de la app: `flujo-web`
3. **NO** activar Firebase Hosting
4. Click en **"Registrar app"**
5. Copiá el objeto `firebaseConfig` que aparece, tiene este formato:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "flujo-fondos-agro.firebaseapp.com",
  projectId: "flujo-fondos-agro",
  storageBucket: "flujo-fondos-agro.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

---

## Paso 5 — Pegar las credenciales en el HTML

Abrí `public/index.html` y buscá este bloque (al inicio del `<script type="module">`):

```javascript
const firebaseConfig = {
  apiKey:            "TU_API_KEY",
  authDomain:        "TU_PROJECT.firebaseapp.com",
  projectId:         "TU_PROJECT_ID",
  storageBucket:     "TU_PROJECT.appspot.com",
  messagingSenderId: "TU_SENDER_ID",
  appId:             "TU_APP_ID"
};
```

Reemplazá cada valor con los de tu proyecto Firebase.

---

## Paso 6 — Subir cambios a GitHub (Netlify redeploya solo)

```bash
git add public/index.html
git commit -m "Integrar Firebase Auth + Firestore"
git push
```

Netlify detecta el push y redeploya en ~30 segundos.

---

## Cómo funciona una vez configurado

| Acción | Comportamiento |
|--------|---------------|
| Abrir el link sin login | Ve el flujo en modo **solo lectura** (sin editar) |
| Login con email/contraseña | Puede **editar** todos los datos |
| Editar cualquier campo | Se guarda automáticamente en Firestore en ~1 segundo |
| Otro usuario abre el mismo link | Ve los datos actualizados **en tiempo real** |
| Cerrar y volver a abrir | Los datos están guardados, no se pierden |

## Indicador de guardado (esquina superior derecha)

- `● LISTO` — sin cambios pendientes
- `● GUARDANDO...` — guardando en Firestore
- `● GUARDADO` — guardado exitosamente
- `● ERROR AL GUARDAR` — revisar conexión o credenciales

## Plan gratuito Firebase (Spark)

| Recurso | Límite gratuito | Tu uso estimado |
|---------|----------------|----------------|
| Lecturas Firestore | 50.000/día | ~100/día ✓ |
| Escrituras Firestore | 20.000/día | ~50/día ✓ |
| Usuarios Auth | Ilimitado | 2-5 ✓ |
| Almacenamiento | 1 GB | < 1 MB ✓ |

**Conclusión: el plan gratuito es más que suficiente para este uso.**
