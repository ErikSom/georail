import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { globSync } from 'glob';
import { execFile } from 'child_process';
import { createRequire } from 'module';

// CORE LIBRARY
import { NodeIO } from '@gltf-transform/core';

// EXTENSIONS & PLUGINS
import {
  KHRDracoMeshCompression,
  EXTTextureWebP
} from '@gltf-transform/extensions';

import {
  textureCompress,
  prune,
  dedup
} from '@gltf-transform/functions';

import draco3d from 'draco3d';
import sharp from 'sharp';

const require = createRequire(import.meta.url);

// --- SETUP EXTERNAL BINARIES ---
let fbx2gltf = require('fbx2gltf');

if (typeof fbx2gltf !== 'string') {
  const platform = os.platform() === 'darwin' ? 'Darwin' :
    os.platform() === 'win32' ? 'Windows' : 'Linux';

  fbx2gltf = path.resolve(
    process.cwd(),
    'node_modules',
    'fbx2gltf',
    'bin',
    platform,
    platform === 'Windows' ? 'fbx2gltf.exe' : 'fbx2gltf'
  );
}

// --- CONFIGURATION ---
const BASE_DIR = './asset-pipeline';

const CONFIG = {
  srcDir: `${BASE_DIR}/src`,
  outDir: `${BASE_DIR}/build`,

  obfuscation: {
    enabled: false,
    key: 16.28,
    strength: 0.5,
    frequency: 10.0,
  },

  dracoOptions: {
    method: 'sequential',
    quantizePosition: 20,
    quantizeNormal: 10,
    quantizeTexcoord: 12,
    quantizeColor: 8,
    quantizeGeneric: 12,
  },

  textureOptions: {
    format: 'webp',
    quality: 100,
    size: [4096, 4096]
  }
};

// --- UTILITIES ---

const sanitizeName = (fileName) => {
  const nameWithoutExt = path.parse(fileName).name;
  return nameWithoutExt.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
};

const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const convertFbxToGlb = (srcPath, destPath) => {
  return new Promise((resolve, reject) => {
    const args = ['--binary', '--input', srcPath, '--output', destPath];
    execFile(fbx2gltf, args, (error, stdout, stderr) => {
      if (error) {
        console.error(`\n⚠️  FBX Error ${path.basename(srcPath)}:\n`, stderr);
        reject(error);
      } else {
        resolve(destPath);
      }
    });
  });
};

const getTextureStats = (document) => {
  const stats = [];
  document.getRoot().listTextures().forEach((texture, index) => {
    const image = texture.getImage();
    if (image) {
      stats.push({
        name: texture.getName() || `Texture_${index}`,
        mime: texture.getMimeType(),
        size: image.byteLength
      });
    }
  });
  return stats;
};

/**
 * 🛠️ MANUAL FIXER
 * Iterates over textures that gltf-transform doesn't recognize
 * and forces them to become WebP using Sharp.
 */
const fixUnknownTextures = async (document) => {
  const textures = document.getRoot().listTextures();

  for (const texture of textures) {
    const mime = texture.getMimeType();
    const name = texture.getName() || '';

    // If it's "unknown" or explicitly a TIFF file
    if (name.toLowerCase().endsWith('.tif')) {
      const imageBuffer = texture.getImage();

      if (imageBuffer) {
        try {
          // Force conversion to WebP
          const newBuffer = await sharp(imageBuffer, { failOn: 'none' })
            .resize({
              width: CONFIG.textureOptions.size[0],
              height: CONFIG.textureOptions.size[1],
              fit: 'inside',
              withoutEnlargement: true
            })
            .webp({ quality: CONFIG.textureOptions.quality })
            .toBuffer();

          // Update the GLTF texture object
          texture.setImage(newBuffer);
          texture.setMimeType('image/webp');
        } catch (e) {
          console.warn(`      ⚠️ Could not convert texture ${name}: ${e.message}`);
        }
      }
    }
  }
};

const processGlb = async (filePath) => {
  try {
    const io = new NodeIO()
      .registerExtensions([KHRDracoMeshCompression, EXTTextureWebP])
      .registerDependencies({
        'draco3d.decoder': await draco3d.createDecoderModule(),
        'draco3d.encoder': await draco3d.createEncoderModule(),
      });

    const document = await io.read(filePath);
    const root = document.getRoot();

    // --- 1. OBFUSCATION ---
    if (CONFIG.obfuscation.enabled) {
      const { key, strength, frequency } = CONFIG.obfuscation;
      for (const mesh of root.listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
          const positionAccessor = prim.getAttribute('POSITION');
          if (!positionAccessor) continue;
          const count = positionAccessor.getCount();
          for (let i = 0; i < count; i++) {
            let [x, y, z] = positionAccessor.getElement(i, []);
            x = x + Math.sin(y * frequency + key) * strength;
            y = y + Math.cos(x * frequency + key) * strength;
            z = z + Math.sin((x + y) * frequency + key) * strength;
            positionAccessor.setElement(i, [x, y, z]);
          }
        }
      }
    }

    // --- 2. PRE-STATS ---
    const preStats = getTextureStats(document);

    // --- 3. MANUAL TIFF FIX ---
    // This runs BEFORE the standard pipeline to fix the "unknown" mime types
    await fixUnknownTextures(document);

    // --- 4. STANDARD OPTIMIZATION ---
    await document.transform(
      dedup(),
      // We run prune here to remove the old TIFF data we just replaced
      prune()
    );

    // --- 5. POST-STATS ---
    const postStats = getTextureStats(document);

    console.log('\n   📦 Texture Compression Report:');
    if (preStats.length === 0) {
      console.log('      No textures found.');
    } else {
      preStats.forEach((pre, i) => {
        const post = postStats[i] || { size: 0, mime: 'deleted' };
        const saved = pre.size - post.size;
        const percent = pre.size > 0 ? ((saved / pre.size) * 100).toFixed(1) : 0;

        console.log(`      - ${pre.name}:`);
        console.log(`        ${pre.mime} (${formatBytes(pre.size)}) -> ${post.mime} (${formatBytes(post.size)})`);
        console.log(`        Saved: ${formatBytes(saved)} (${percent}%)`);
      });
    }
    console.log('');

    // --- 6. GEOMETRY COMPRESSION ---
    document.createExtension(KHRDracoMeshCompression)
      .setRequired(true)
      .setEncoderOptions({
        method: CONFIG.dracoOptions.method === 'edgebreaker' ? 1 : 0,
        quantizationBits: {
          POSITION: CONFIG.dracoOptions.quantizePosition,
          NORMAL: CONFIG.dracoOptions.quantizeNormal,
          TEX_COORD: CONFIG.dracoOptions.quantizeTexcoord,
          COLOR: CONFIG.dracoOptions.quantizeColor,
          GENERIC: CONFIG.dracoOptions.quantizeGeneric,
        }
      });

    await io.write(filePath, document);
    return true;

  } catch (err) {
    console.error(`Error processing ${filePath}:`, err);
    throw err;
  }
};

// --- MAIN PIPELINE ---

const run = async () => {
  console.log('🚀 Starting Asset Pipeline...');
  console.log(`🔒 Obfuscation: ${CONFIG.obfuscation.enabled ? 'ENABLED' : 'DISABLED'}`);

  await fs.ensureDir(CONFIG.outDir);
  await fs.emptyDir(CONFIG.outDir);

  const files = globSync(`${CONFIG.srcDir}/**/*.fbx`);

  if (files.length === 0) {
    console.log('No FBX files found.');
    return;
  }

  for (const srcPath of files) {
    const relativePath = path.relative(CONFIG.srcDir, srcPath);
    const dirName = path.dirname(relativePath);
    const sanitizedName = sanitizeName(srcPath);

    const outFolderPath = path.join(CONFIG.outDir, dirName);
    const outFilePath = path.join(outFolderPath, `${sanitizedName}.glb`);
    const fbmFolderPath = srcPath.substring(0, srcPath.lastIndexOf('.')) + '.fbm';

    await fs.ensureDir(outFolderPath);

    process.stdout.write(`Processing: ${path.basename(srcPath)} -> ${sanitizedName}.glb ... `);

    try {
      await convertFbxToGlb(srcPath, outFilePath);

      if (await fs.pathExists(fbmFolderPath)) {
        await fs.remove(fbmFolderPath);
      }

      await processGlb(outFilePath);

      console.log('✅ Done');
    } catch (err) {
      console.log('❌ Failed');
      console.error(err);
    }
  }

  console.log('✨ Build Complete.');
};

run();