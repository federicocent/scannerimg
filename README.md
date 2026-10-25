# ScannerIMG (ScannerPDF)

Aplicación web para escanear documentos e imágenes y exportarlos a un archivo **PDF** (una imagen por página), construida con **Node.js**, **Express**, **Tailwind CSS**, **Sharp** y **pdf-lib**.

## Características principales

- **Detección y recorte automático de hoja**: Al subir una fotografía, el sistema detecta automáticamente los 4 bordes de la hoja de papel, corrige la perspectiva (homografía de 4 puntos) y recorta el fondo.
- **Editor de recorte manual con lupa de precisión**: Si deseas ajustar el recorte automático, puedes arrastrar cualquiera de las **4 esquinas** o los **4 bordes completos** con vista de lupa en tiempo real (2.5x), re-detectar la hoja o usar la imagen completa.
- **Filtros de escaneo de documentos**:
  - **Color Mágico**: Elimina sombras e iluminación irregular, blanquea el papel y resalta los colores de tinta, sellos y firmas.
  - **Blanco y Negro Nítido**: Umbral adaptativo local con bordes suavizados estilo escáner láser.
  - **Escala de Grises**: Documento limpio en tonos de gris sin sombras de fondo.
  - **Original**: Conserva la fotografía sin filtro de iluminación.
- **Organización de páginas**: Reordena las páginas arrastrando y soltando (drag & drop) o usando las flechas, gira páginas de 90° en 90° o elimina páginas individuales.
- **Exportación a PDF a medida**: Configura el nombre del archivo, el tamaño de hoja (`A4`, `Carta / Letter` o `Ajustar a cada imagen`), la orientación (`Automática`, `Vertical`, `Horizontal`) y el margen (`Sin margen`, `Pequeño`, `Normal`).
- **100% Local**: No requiere claves de API externas ni conexión a servicios de terceros.

---

## Requisitos previos

Para ejecutar este proyecto en tu equipo necesitas tener instalado:

- **[Node.js](https://nodejs.org/)** v18.0.0 o superior (recomendado Node.js v20 o v22 LTS).
- **npm** (incluido automáticamente con Node.js).

Puedes verificar si los tienes instalados ejecutando en tu terminal:

```bash
node -v
npm -v
```

---

## Instalación y cómo correrlo

Sigue estos pasos para clonar y levantar el proyecto localmente:

### 1. Clonar el repositorio

```bash
git clone https://github.com/federicocent/scannerimg.git
cd scannerimg
```

### 2. Instalar las dependencias

```bash
npm install
```

### 3. Compilar los estilos de Tailwind CSS (opcional si modificas el diseño)

El archivo `public/styles.css` ya viene compilado, pero si realizas cambios en el HTML o CSS puedes recompilarlo con:

```bash
npm run build:css
```

### 4. Iniciar el servidor

```bash
npm start
```

Para modo de desarrollo con recarga automática al editar archivos:

```bash
npm run dev
```

### 5. Abrir en el navegador

Una vez iniciado el servidor, abre tu navegador en:

```text
http://localhost:3000
```

*(Si deseas usar otro puerto, puedes definir la variable de entorno `PORT`, por ejemplo `PORT=4000 npm start`).*

---

## Cómo usar la aplicación

1. **Subir imágenes**: Arrastra tus fotos (JPG, PNG, WEBP) al recuadro principal o haz clic en **Seleccionar imágenes**.
2. **Revisión y ajuste**:
   - Cada foto se recortará automáticamente detectando la hoja de papel y se le aplicará el filtro de escaneo seleccionado.
   - Si quieres ajustar el área recortada de alguna hoja, haz clic en **Modificar recorte** dentro de su tarjeta y mueve las esquinas o los bordes.
   - Puedes girar la imagen, cambiar el filtro individualmente o aplicar un filtro a todas las páginas con **Aplicar filtro a todas**.
   - Arrastra las tarjetas para cambiar el orden en que aparecerán en el PDF.
3. **Descargar PDF**: Elige el nombre del archivo, tamaño de hoja, orientación y margen, y haz clic en **Crear PDF** o **Descargar PDF**.

---

## Ejecutar pruebas automatizadas

El proyecto incluye pruebas de extremo a extremo (E2E) que validan la subida de imágenes, la detección automática de bordes, el recorte manual y la generación del PDF:

```bash
npm test
```

---

## Estructura del proyecto

```text
├── public/
│   ├── index.html          # Interfaz de usuario principal
│   ├── app.js              # Lógica del cliente (subida, editor de recorte con lupa, reordenamiento)
│   └── styles.css          # Estilos compilados de Tailwind CSS
├── src/
│   ├── server.js           # Servidor Express
│   ├── input.css           # Entrada de Tailwind CSS
│   ├── routes/
│   │   └── scanRoutes.js   # Rutas API (/api/upload, /api/images, /api/pdf)
│   └── services/
│       ├── scannerService.js # Detección de hoja, homografía 4 puntos y filtros de escaneo
│       └── pdfService.js     # Construcción del documento PDF (1 imagen por página)
├── tests/
│   └── scanner.test.js     # Pruebas de integración E2E
└── package.json
```
