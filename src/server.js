const express = require('express');
const path = require('path');
const scanRoutes = require('./routes/scanRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

// API Routes
app.use('/api', scanRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[ScannerPDF Error]:', err.message);
  const status = err.status || 400;
  res.status(status).json({
    error: err.message || 'Ocurrió un error al procesar las imágenes.',
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ScannerPDF corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;
