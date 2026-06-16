# Cali Cultural Tours — Sitio Web Oficial

Sitio web estático (Astro 6) para **Cali Cultural Tours**: tours gastronómicos, culturales, naturaleza y experiencias en Cali, Colombia. Incluye sistema de reservas con pagos online (Bold.co) y WhatsApp para grupos.

---

## 🚀 Stack Tecnológico

| Componente | Versión |
|------------|---------|
| Framework | **Astro 6.1.4** (Static Site Generation) |
| Lenguaje | TypeScript / JavaScript (ESM) |
| Estilos | CSS puro + Variables CSS (sin frameworks) |
| Pagos | **Bold.co** (checkout links por tour + cantidad) |
| Deploy | GitHub Pages (Actions) o Vercel/Netlify |
| Node | ≥ 22.12.0 |

---

## 📁 Estructura del Proyecto

```
cct-entrega-cliente/
├── .github/workflows/deploy.yml   # Deploy automático a GitHub Pages
├── public/
│   ├── favicon.ico / favicon.svg
│   └── images/
│       ├── logo.jpg
│       ├── about-image.jfif
│       ├── home-hero.jpg / .webp
│       ├── og-image.jpg
│       └── tours/
│           ├── *-hero.jpg / .webp      # Imágenes hero por tour
│           ├── *-thumb.jpg / .webp     # Thumbnails por tour
│           └── [carpetas extra por tour]  # Galerías adicionales
├── src/
│   ├── data/
│   │   ├── site_content_skeleton.json  # TODO el contenido: textos, tours, business info
│   │   ├── payment_links.json          # Links Bold.co (1-3 personas por tour) - YA CONFIGURADOS
│   │   └── payment_data.json           # Datos de precios (referencia)
│   ├── layouts/
│   │   └── BaseLayout.astro            # Layout base: SEO, Schema.org, nav, footer, WhatsApp float
│   ├── pages/
│   │   ├── index.astro                 # Home
│   │   ├── tours.astro                 # Listado de tours
│   │   ├── tours/[id].astro            # Detalle de tour (gallery, precio, itinerario, relacionados)
│   │   ├── book.astro                  # Reserva 3 pasos + cálculo dinámico + Bold/WA
│   │   ├── contact.astro
│   │   ├── safety.astro
│   │   ├── local-info.astro
│   │   ├── map.astro
│   │   └── activities.astro
│   └── styles/
│       └── main.css                    # Estilos globales + variables CSS
├── astro.config.mjs
├── package.json
├── tsconfig.json
├── robots.txt
└── sitemap.xml
```

---

## ✅ QUÉ YA VIENE CONFIGURADO (FUNCIONA OUT OF THE BOX)

| Dato | Valor | Dónde cambiar si necesitas |
|------|-------|---------------------------|
| **Dominio** | `https://www.caliculturaltours.com` | `src/layouts/BaseLayout.astro` línea 7 |
| **WhatsApp** | `+57 316 254 3554` (`573162543554`) | `BaseLayout.astro` línea 9 + `book.astro` línea 290 |
| **Email** | `info@caliculturaltours.com` | `BaseLayout.astro` línea 10 |
| **Instagram** | `https://www.instagram.com/caliculturaltours/` | `BaseLayout.astro` línea 11 |
| **RNT** | `196165` | `BaseLayout.astro` línea 12 |
| **Links Bold.co** | **24 links reales** (8 tours × 3 cantidades) | `src/data/payment_links.json` |

> **Los links de Bold.co YA SON LOS REALES** del negocio. Si Bold.co los cambia o quieres otros, editas `payment_links.json`.

---

## 🛠️ Desarrollo Local

```bash
# 1. Instalar dependencias
npm install

# 2. Servidor de desarrollo (http://localhost:4321)
npm run dev

# 3. Build de producción (genera carpeta dist/)
npm run build

# 4. Preview del build local
npm run preview
```

---

## 🚀 Deploy

### Opción A: GitHub Pages (Incluido - Gratis)
1. Push a `main` → GitHub Action compila y despliega automáticamente
2. Settings → Pages → Source: "GitHub Actions"
3. URL: `https://juancho-create.github.io/cct-entrega-cliente/` 
   - **O** configura dominio propio: Settings → Pages → Custom domain → `www.caliculturaltours.com`

### Opción B: Vercel (Recomendado - Mejor rendimiento)
```bash
npm i -g vercel
vercel login
vercel --prod
```
- Detecta Astro automáticamente
- Preview deployments en cada PR
- Edge network global

### Opción C: Netlify
- Conecta repo → Build command: `npm run build` → Publish dir: `dist`

---

## 📝 Cómo Modificar Contenido (Sin Tocar Código)

| Qué cambiar | Archivo | Qué editar |
|-------------|---------|------------|
| Textos, descripciones, info tours | `src/data/site_content_skeleton.json` | Secciones `content`, `tours[]` |
| Precios mostrados | `site_content_skeleton.json` | `tours[].price` (ej: `"From 85,000 COP"`) |
| Links de pago Bold.co | `src/data/payment_links.json` | URLs por tour y cantidad (1,2,3) |
| Imágenes tours | `public/images/tours/` + JSON | `tour.image`, `tour.gallery[]` |
| Dominio, WhatsApp, Email, Instagram, RNT | `src/layouts/BaseLayout.astro` | **Líneas 7-12** (constantes arriba) |
| WhatsApp en formulario reservas | `src/pages/book.astro` | **Línea ~290** (`WHATSAPP_NUMBER`) |
| SEO (title, description, OG, Schema) | `BaseLayout.astro` + `site_content_skeleton.json` | Constantes + `business` |

**No hace falta tocar código Astro/TS/CSS** para cambios de contenido.

---

## 🔧 Variables CSS Principales (`src/styles/main.css`)

```css
:root {
  --cct-primary: #E8005A;      /* Rosa principal */
  --cct-primary-dark: #C4004A;
  --cct-text-main: #1A1A1A;
  --cct-text-light: #6B6B6B;
  --cct-bg-light: #FAFAFA;
  --cct-white: #FFFFFF;
  --font-serif: 'Playfair Display', serif;
  --font-body: 'Inter', sans-serif;
  --font-heading: 'Outfit', sans-serif;
}
```
Cambia colores/fonts globales aquí.

---

## 📦 Scripts Disponibles

```json
{
  "dev": "astro dev",
  "build": "astro build",
  "preview": "astro preview",
  "astro": "astro"
}
```

---

## ⚠️ CHECKLIST SI CAMBIAS ALGO CRÍTICO

- [ ] Si cambias **dominio**: actualiza `SITE_URL` en `BaseLayout.astro` + `robots.txt` + `sitemap.xml`
- [ ] Si cambias **WhatsApp**: actualiza en `BaseLayout.astro` (2 lugares) Y `book.astro` (1 lugar)
- [ ] Si cambias **links Bold.co**: edita `src/data/payment_links.json` manteniendo estructura `{tourId: { "1": url, "2": url, "3": url }}`
- [ ] Si cambias **email/Instagram/RNT**: edita `BaseLayout.astro` líneas 10-12
- [ ] **Siempre**: `npm run build` local y verifica que compila sin errores antes de push

---

## 🧪 Cómo Probar el Flujo de Reservas

1. `npm run dev` → abre `http://localhost:4321/book`
2. **1-3 personas**: selecciona tour → fecha → huéspedes (1-3) → Continue → datos → **Proceed to Payment** → abre link Bold.co real
3. **4+ personas**: mismo flujo pero huéspedes 4+ → **Contact Us to Book** → abre WhatsApp con mensaje prellenado
4. Verifica que los prices calculan bien (precio × huéspedes)

---

## 📄 Licencia / Uso

Código entregado para **Cali Cultural Tours**. Libre para usar, modificar y deployar en su infraestructura.  
**No incluye**: scripts de automatización internos, configs de editores, docs de mantenimiento/SEO, know-how de integración Bold.co.

---

## ⚖️ DESCARGO DE RESPONSABILIDAD

**Este código se entrega "tal cual" (AS IS).** Una vez deployado en TU infraestructura (tu cuenta GitHub, tu Vercel, tu Bold.co, tu dominio), **tú eres responsable de**:
- El correcto funcionamiento de los pagos (verifica cada link Bold en sandbox/producción)
- La recepción de notificaciones de reservas (WhatsApp, email)
- El cumplimiento normativo (RNT, protección de datos, términos de servicio)
- El mantenimiento, actualizaciones de seguridad, backups

**No hay garantías implícitas ni explícitas** de funcionamiento continuo, compatibilidad futura con terceros (Bold, Vercel, GitHub, WhatsApp), ni ausencia de bugs. Cualquier modificación, bug fix, feature nueva o soporte técnico posterior a la entrega se cotiza por separado.

---

## 🤝 Soporte Técnico (Post-Entrega)

| Qué está INCLUIDO en la entrega | Qué NO está incluido (se cotiza aparte) |
|--------------------------------|------------------------------------------|
| Repo limpio funcionando | Cambios de diseño/UX |
| Código documentado en README | Panel admin visual (CMS) |
| Instrucciones para modificaciones básicas | Nuevas pasarelas de pago |
| Deploy configurado (GitHub Pages) | Multi-idioma, blog, newsletter |
| Fix de bugs **del código original** (7 días) | Mantenimiento continuo / hosting |

**Para cualquier duda o trabajo extra: hablamos y cotizamos.**