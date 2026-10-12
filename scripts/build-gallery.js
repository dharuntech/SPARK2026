const esbuild = require('esbuild');
const path = require('path');

async function build() {
  try {
    const result = await esbuild.build({
      entryPoints: [path.join(__dirname, '../src/components/mountGallery.jsx')],
      bundle: true,
      outfile: path.join(__dirname, '../public/vendor/circular-gallery.bundle.js'),
      format: 'iife',
      globalName: 'SparkGallery',
      minify: true,
      sourcemap: false,
      jsx: 'automatic',
      loader: {
        '.js': 'jsx',
        '.jsx': 'jsx',
        '.css': 'css'
      },
      define: {
        'process.env.NODE_ENV': '"production"'
      }
    });
    console.log('CircularGallery bundle created successfully at public/vendor/circular-gallery.bundle.js');
  } catch (err) {
    console.error('CircularGallery build failed:', err);
    process.exit(1);
  }
}

build();
