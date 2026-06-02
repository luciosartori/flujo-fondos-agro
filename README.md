# Flujo de Fondos Agropecuario — Deploy en Netlify

## Estructura del proyecto

```
flujo-agro/
├── netlify.toml                          ← configuración Netlify
├── package.json
├── public/
│   └── index.html                        ← la aplicación principal
└── netlify/
    └── functions/
        ├── futuros-agro.js               ← proxy MatbaRofex granos
        └── futuros-financieros.js        ← proxy MatbaRofex financieros
```

## Paso 1 — Subir a GitHub

1. Crear un repositorio nuevo en GitHub (puede ser privado)
2. Subir esta carpeta completa:
   ```
   git init
   git add .
   git commit -m "Flujo de fondos agropecuario"
   git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
   git push -u origin main
   ```

## Paso 2 — Conectar con Netlify

1. Ir a https://app.netlify.com
2. Click en **"Add new site" → "Import an existing project"**
3. Conectar con GitHub y seleccionar el repositorio
4. Configuración de build:
   - **Base directory:** (dejar vacío)
   - **Build command:** (dejar vacío)
   - **Publish directory:** `public`
5. Click **"Deploy site"**

Netlify asignará una URL del tipo: `https://nombre-random-123.netlify.app`

## Paso 3 — Actualizar la URL en el HTML

Abrir `public/index.html` y en la línea:
```javascript
const NETLIFY_BASE = "https://TU-SITIO.netlify.app"; // <-- CAMBIAR
```
Reemplazar con tu URL real:
```javascript
const NETLIFY_BASE = "https://nombre-random-123.netlify.app";
```

Guardar, hacer commit y push. Netlify redeploya automáticamente.

## Datos en vivo

| Fuente | Qué trae | Frecuencia |
|--------|----------|------------|
| dolarapi.com | TC BNA minorista vendedor y mayorista comprador | Cada 5 min |
| MatbaRofex/A3 (via Netlify proxy) | Futuros soja y maíz Rosario | Cada 5 min |
| MatbaRofex/A3 (via Netlify proxy) | Futuros financieros dólar Rofex | Cada 5 min |

## Fallback automático

Si alguna fuente no está disponible, la app usa automáticamente:
- **TC:** valores del último fetch o override manual del usuario
- **Futuros agro:** precios de la captura de pantalla del 27/05/2026
- Los precios se interpolan al último mes cotizado disponible

## Indicadores de estado (panel superior)

- 🟢 **LIVE** — dato en tiempo real
- 🟡 **FALLBACK** — dato estático de respaldo  
- 🔴 **ERROR** — fallo de conexión

## Notas importantes

- Las Netlify Functions tienen **125.000 ejecuciones gratuitas/mes** (más que suficiente)
- El HTML se puede abrir localmente también (funciona con fallback)
- El tipo de cambio BNA se actualiza cada 5 minutos automáticamente
- Los futuros de MatbaRofex se actualizan en horario de mercado
