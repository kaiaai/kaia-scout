import typescript from 'rollup-plugin-typescript2';

export default {
  input: 'src/kaia-scout.ts',
  plugins: [typescript()],
  output: [{
    file: 'dist/kaia-scout-iife.js',
    format: 'iife',
    name: 'kaiaScoutJs'
  }, {
    file: 'dist/kaia-scout-cjs.js',
    format: 'cjs'
  }, {
    file: 'dist/kaia-scout.mjs',
    format: 'es'
  }, {
    file: 'dist/kaia-scout-amd.js',
    format: 'amd',
  }]
};
