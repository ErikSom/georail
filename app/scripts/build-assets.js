import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { globSync } from 'glob';
import { execFile } from 'child_process';
import { createRequire } from 'module';
import gltfPipeline from 'gltf-pipeline';

// NEW: Import the library for modifying geometry
import { NodeIO } from '@gltf-transform/core';

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

const { processGlb } = gltfPipeline;

// --- CONFIGURATION ---

const BASE_DIR = './asset-pipeline';

const CONFIG = {
  srcDir: `${BASE_DIR}/src`,
  outDir: `${BASE_DIR}/build`,

  obfuscation: {
    enabled: true,
    key: 123.45,
    strength: 0.5,
    frequency: 10.0,
  },

  dracoOptions: {
    compressionLevel: 7,
    quantizePositionBits: 14,
    quantizeNormalBits: 10,
    quantizeTexcoordBits: 12,
    quantizeColorBits: 8,
    quantizeGenericBits: 12,
  }
};

// --- UTILITIES ---

const sanitizeName = (fileName) => {
  const nameWithoutExt = path.parse(fileName).name;
  return nameWithoutExt.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
};

const convertFbxToGlb = (srcPath, destPath) => {
  return new Promise((resolve, reject) => {
    // --binary is crucial for the next steps
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

/**
 * 2. The Obfuscator Function
 * Reads the GLB, scrambles vertices using the Feistel logic, saves it back.
 */
const obfuscateGlb = async (filePath) => {
  try {
    const io = new NodeIO();
    const document = await io.read(filePath); // Read the freshly made GLB
    const root = document.getRoot();

    const { key, strength, frequency } = CONFIG.obfuscation;

    // Iterate over every mesh and primitive in the file
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const positionAccessor = prim.getAttribute('POSITION');
        if (!positionAccessor) continue;

        const count = positionAccessor.getCount();

        for (let i = 0; i < count; i++) {
          let [x, y, z] = positionAccessor.getElement(i, []);

          // --- THE SCRAMBLE LOGIC ---
          // Step 1: Distort X based on Y
          x = x + Math.sin(y * frequency + key) * strength;

          // Step 2: Distort Y based on NEW X
          y = y + Math.cos(x * frequency + key) * strength;

          // Step 3: Distort Z based on NEW X and NEW Y
          z = z + Math.sin((x + y) * frequency + key) * strength;

          positionAccessor.setElement(i, [x, y, z]);
        }
      }
    }

    // Overwrite the file with the scrambled version
    await io.write(filePath, document);
    return true;

  } catch (err) {
    console.error(`Error obfuscating ${filePath}:`, err);
    throw err;
  }
};

const compressGlb = async (filePath) => {
  try {
    const glbBuffer = await fs.readFile(filePath);
    const results = await processGlb(glbBuffer, { dracoOptions: CONFIG.dracoOptions });
    await fs.writeFile(filePath, results.glb);
    return true;
  } catch (err) {
    console.error(`Error compressing ${filePath}:`, err);
    throw err;
  }
};

// --- MAIN PIPELINE ---

const run = async () => {
  console.log('🚀 Starting Asset Pipeline...');
  console.log(`🔒 Obfuscation: ${CONFIG.obfuscation.enabled ? 'ENABLED' : 'DISABLED'}`);

  await fs.ensureDir(CONFIG.outDir);

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

    await fs.ensureDir(outFolderPath);

    process.stdout.write(`Processing: ${path.basename(srcPath)} -> ${sanitizedName}.glb ... `);

    try {
      // Step 1: Convert FBX to clean GLB
      await convertFbxToGlb(srcPath, outFilePath);

      // Step 2: Obfuscate (Scramble Geometry)
      // We do this BEFORE compression so Draco compresses the scrambled state
      if (CONFIG.obfuscation.enabled) {
        await obfuscateGlb(outFilePath);
      }

      // Step 3: Compress (Draco)
      await compressGlb(outFilePath);

      console.log('✅ Done');
    } catch (err) {
      console.log('❌ Failed');
      if (err.code === 'EACCES') {
        console.error('\n🛑 PERMISSION ERROR: Check fbx2gltf binary permissions.');
      } else {
        console.error(err);
      }
    }
  }

  console.log('✨ Build Complete.');
};

run();