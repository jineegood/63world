import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outputDirectory = path.join(root, 'vendor');
const outputFile = path.join(outputDirectory, 'supabase-client.bundle.js');

fs.mkdirSync(outputDirectory, { recursive:true });

await build({
  stdin:{
    contents:"export { createClient } from '@supabase/supabase-js';",
    loader:'js',
    resolveDir:root,
    sourcefile:'supabase-client-entry.js',
  },
  bundle:true,
  platform:'browser',
  format:'iife',
  globalName:'YuksamSupabaseClient',
  target:['es2020'],
  minify:false,
  legalComments:'none',
  banner:{ js:'/* 63world local browser bundle: @supabase/supabase-js 2.110.8 */' },
  outfile:outputFile,
});

console.log(`Built ${path.relative(root, outputFile)}`);
