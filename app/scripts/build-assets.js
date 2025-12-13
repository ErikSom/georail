import fs from 'fs-extra';
import path from 'path';
import os from 'os'; // Added for platform check
import { globSync } from 'glob';
import { execFile } from 'child_process';
import { createRequire } from 'module'; // Added to fix CommonJS import
import gltfPipeline from 'gltf-pipeline';

// 1. Setup 'require' for CommonJS compatibility
const require = createRequire(import.meta.url);

// 2. Import fbx2gltf and ensure we get the BINARY PATH (String)
let fbx2gltf = require('fbx2gltf');

// SAFETY CHECK: If fbx2gltf is not a string path, find the binary manually
// This fixes the "TypeError [ERR_INVALID_ARG_TYPE]"
if (typeof fbx2gltf !== 'string') {
  const platform = os.platform() === 'darwin' ? 'Darwin' :
    os.platform() === 'win32' ? 'Windows' : 'Linux';

  // Construct path manually
  fbx2gltf = path.resolve(
    process.cwd(),
    'node_modules',
    'fbx2gltf',
    'bin',
    platform,
    platform === 'Windows' ? 'fbx2gltf.exe' : 'fbx2gltf'
  );
}

// gltf-pipeline is a CommonJS module, so we destructure it this way in ESM
const { processGlb } = gltfPipeline;

// --- CONFIGURATION ---

const BASE_DIR = './asset-pipeline';

const CONFIG = {
  srcDir: `${BASE_DIR}/src`,
  outDir: `${BASE_DIR}/build`,
  // Draco Compression Settings
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
  return nameWithoutExt
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '');
};

const convertFbxToGlb = (srcPath, destPath) => {
  return new Promise((resolve, reject) => {
    // We now know 'fbx2gltf' is definitely a string path
    const args = ['--binary', '--input', srcPath, '--output', destPath];

    execFile(fbx2gltf, args, (error, stdout, stderr) => {
      if (error) {
        // Log stderr for clearer debugging
        console.error(`\n⚠️  Error Output for ${path.basename(srcPath)}:\n`, stderr);
        reject(error);
      } else {
        resolve(destPath);
      }
    });
  });
};

const compressGlb = async (filePath) => {
  try {
    const glbBuffer = await fs.readFile(filePath);

    const options = {
      dracoOptions: CONFIG.dracoOptions,
    };

    const results = await processGlb(glbBuffer, options);
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
  console.log(`📂 Source: ${CONFIG.srcDir}`);
  console.log(`📂 Output: ${CONFIG.outDir}`);

  await fs.ensureDir(CONFIG.outDir);

  const files = globSync(`${CONFIG.srcDir}/**/*.fbx`);

  if (files.length === 0) {
    console.log('No FBX files found.');
    return;
  }

  console.log(`Found ${files.length} files. Processing...`);

  for (const srcPath of files) {
    const relativePath = path.relative(CONFIG.srcDir, srcPath);
    const dirName = path.dirname(relativePath);
    const sanitizedName = sanitizeName(srcPath);

    const outFolderPath = path.join(CONFIG.outDir, dirName);
    const outFilePath = path.join(outFolderPath, `${sanitizedName}.glb`);

    await fs.ensureDir(outFolderPath);

    process.stdout.write(`Processing: ${path.basename(srcPath)} -> ${sanitizedName}.glb ... `);

    try {
      await convertFbxToGlb(srcPath, outFilePath);
      await compressGlb(outFilePath);
      console.log('✅ Done');
    } catch (err) {
      console.log('❌ Failed');

      // Permission Help Tip
      if (err.code === 'EACCES') {
        console.error('\n🛑 PERMISSION ERROR: Run this command in your terminal to fix it:');
        console.error(`chmod +x "${fbx2gltf}" && xattr -d com.apple.quarantine "${fbx2gltf}"\n`);
      } else {
        console.error(err);
      }
    }
  }

  console.log('✨ Build Complete.');
};

run();