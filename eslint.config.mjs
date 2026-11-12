import babelParser from '@babel/eslint-parser';
export default [
 {ignores:['node_modules/**','.next/**','vendor/**','third-party-licenses/**','data/**','next-env.d.ts']},
 {files:['src/**/*.{js,mjs,ts,tsx}','scripts/*.mjs','tests/**/*.mjs'],languageOptions:{ecmaVersion:'latest',sourceType:'module',parser:babelParser,parserOptions:{requireConfigFile:false,babelOptions:{parserOpts:{plugins:['typescript','jsx']}}}},rules:{
  'constructor-super':'error','for-direction':'error','getter-return':'error','no-async-promise-executor':'error','no-cond-assign':['error','always'],'no-constant-binary-expression':'error','no-debugger':'error','no-dupe-args':'error','no-dupe-class-members':'error','no-dupe-else-if':'error','no-dupe-keys':'error','no-duplicate-case':'error','no-empty-character-class':'error','no-eval':'error','no-ex-assign':'error','no-fallthrough':'error','no-invalid-regexp':'error','no-irregular-whitespace':'error','no-loss-of-precision':'error','no-misleading-character-class':'error','no-new-symbol':'error','no-promise-executor-return':'error','no-prototype-builtins':'error','no-self-assign':'error','no-setter-return':'error','no-sparse-arrays':'error','no-this-before-super':'error','no-unreachable':'error','no-unsafe-finally':'error','no-unsafe-negation':'error','no-unsafe-optional-chaining':'error','use-isnan':'error','valid-typeof':'error'
 }}
];
