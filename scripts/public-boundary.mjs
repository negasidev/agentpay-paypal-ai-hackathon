import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const inside=(root,path)=>{const rel=relative(root,path);return rel!== '..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);};
const privateFile=path=>/(^|\/)(?:node_modules|\.next|data|test-results|\.vercel|\.artifacts|\.aws|\.ssh|\.azure|\.gcloud)(\/|$)/.test(path)||
 /(^|\/)\.env(?:\.|$)/.test(path)&&!['.env.example','.env.hosted.example'].includes(path)||
 /(?:^|[/.])private(?:[/.]|$)/i.test(path)||
 /\.(?:pem|pfx|p12|key|tsbuildinfo|log|trx|sqlite|sqlite3|db)$/i.test(path);
const contentRules=[
 ['WORKSTATION_PATH',/(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/][^\s'"<>]|\\\\(?:[A-Za-z0-9-]+\.)+[A-Za-z0-9-]+\\[A-Za-z0-9._-]+|\/(?:Users|home)\/[^ /]+\/)/],
 ['PRIVATE_KEY',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
 ['PROVIDER_TOKEN',/(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|sk-(?:ant-|proj-)[A-Za-z0-9_-]{30,}|sk_live_[A-Za-z0-9]{20,})/],
 ['PRIVATE_NETWORK_URL',/https?:\/\/(?:[^\s/'"<>]+\.(?:internal|local)(?=[:/'"\s]|$)|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)/i],
];

// Paths and rule names are enough to repair a failure; printing matches could
// disclose the very credential this check is intended to keep out of releases.
export function auditPublicFiles(root,files){
 root=realpathSync(root);const findings=[];
 const add=(path,rule)=>findings.push({path,rule});
 for(const name of files){
  const path=name.replaceAll('\\','/'),absolute=resolve(root,path);
  if(!inside(root,absolute)){add(path,'OUTSIDE_REPOSITORY');continue;}
  if(privateFile(path))add(path,'PRIVATE_RELEASE_FILE');
  if(!existsSync(absolute)){add(path,'MISSING_RELEASE_FILE');continue;}
  if(lstatSync(absolute).isSymbolicLink()||!inside(root,realpathSync(absolute))){add(path,'RELEASE_SYMLINK');continue;}
  if(!lstatSync(absolute).isFile()){add(path,'NESTED_REPOSITORY_OR_DIRECTORY');continue;}
  const bytes=readFileSync(absolute);if(bytes.subarray(0,8192).includes(0))continue;
  const source=bytes.toString('utf8');
  for(const [rule,pattern] of contentRules)if(!(rule==='PRIVATE_NETWORK_URL'&&path.startsWith('tests/'))&&pattern.test(source))add(path,rule);
  if(['.env.example','.env.hosted.example'].includes(path)){
   for(const line of source.split(/\r?\n/)){
    const setting=/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);if(!setting)continue;
    const [,key,raw]=setting,value=raw.replace(/^(['"])(.*)\1$/,'$2');
    if(!value)continue;
    if(key==='DATABASE_URL'){
     try{const url=new URL(value);if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!['change-me','local-demo-only','local-only'].includes(decodeURIComponent(url.password))||url.search||url.hash)add(path,'POPULATED_CREDENTIAL_TEMPLATE');}
     catch{add(path,'POPULATED_CREDENTIAL_TEMPLATE');}
    }else if(/(?:SECRET|PASSWORD|TOKEN|PRIVATE|API_KEY|KEY_HEX|CLIENT_ID|MERCHANT_ID|TENANT_ID|PRINCIPAL_ID|AGENT_ID|INTENT_ID|SMTP_USER|USER_EMAIL)/.test(key))add(path,'POPULATED_CREDENTIAL_TEMPLATE');
   }
  }
  if(/\.(?:[cm]?js|[cm]?ts|tsx|jsx)$/.test(path)){
   const check=(specifier,resource=false)=>{
    if(!specifier.startsWith('.'))return;
    const target=resolve(dirname(absolute),specifier);
    const generated=(path==='next-env.d.ts'&&/^\.\/\.next\/types\/[a-z-]+\.d\.ts$/.test(specifier))||
     (path==='scripts/start.mjs'&&specifier==='../.next/standalone/server.js');
    if(!inside(root,target))add(path,resource?'EXTERNAL_SOURCE_RESOURCE':'EXTERNAL_SOURCE_IMPORT');
    else if(!generated&&!existsSync(target)&&!(resource?[]:['.ts','.tsx','.js','.mjs','.json','/index.ts','/index.tsx','/index.js']).some(suffix=>existsSync(target+suffix)))add(path,resource?'MISSING_SOURCE_RESOURCE':'MISSING_SOURCE_IMPORT');
   };
   const imports=source.matchAll(/(?:^|[;}])\s*(?:import|export)\s*(?:[^'"\r\n;]*?\bfrom\s*)?['"](\.[^'"\r\n]+)['"]/gm);
   for(const match of imports)check(match[1]);
   if(!path.startsWith('tests/')){
    for(const match of source.matchAll(/(?:^|[;}])\s*(?:await\s+)?import\(\s*['"](\.[^'"\r\n]+)['"]\s*\)/gm))check(match[1]);
    for(const match of source.matchAll(/new URL\(\s*['"](\.[^'"\r\n]+)['"]\s*,\s*import\.meta\.url\s*\)/g))check(match[1],true);
   }
  }
  if(path.endsWith('package.json')||path.endsWith('package-lock.json')){
   const walk=value=>{if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){
    if(typeof item==='string'&&/^(?:git\+ssh:|ssh:|git@)/i.test(item))add(path,'AUTHENTICATED_PACKAGE_DEPENDENCY');
    if(typeof item==='string'&&(item.startsWith('file:')||key==='resolved'&&!/^[a-z]+:/i.test(item)&&!item.startsWith('@'))){
     const local=item.replace(/^file:/,'');const target=resolve(dirname(absolute),local);
     if(!inside(root,target))add(path,'EXTERNAL_PACKAGE_DEPENDENCY');
     else if(!existsSync(target))add(path,'MISSING_PACKAGE_DEPENDENCY');
    }else walk(item);
   }};
   try{walk(JSON.parse(source));}catch{add(path,'INVALID_PACKAGE_JSON');}
  }
  if(path.endsWith('.md')&&!path.startsWith('third-party-licenses/')){
   for(const match of source.matchAll(/!?\[[^\]\r\n]*\]\(<?([^\s)>]+)>?(?:\s+[^)]*)?\)/g)){
    const link=match[1];
    if(link.startsWith('#')||/^(?:https?:|mailto:)/i.test(link))continue;
    if(/^[a-z][a-z0-9+.-]*:/i.test(link)){add(path,'NONPUBLIC_DOCUMENT_LINK');continue;}
    let target;
    try{target=resolve(dirname(absolute),decodeURIComponent(link.split('#')[0]));}catch{add(path,'INVALID_DOCUMENT_LINK');continue;}
    if(!inside(root,target))add(path,'EXTERNAL_DOCUMENT_LINK');
    else if(!existsSync(target))add(path,'MISSING_DOCUMENT_LINK');
   }
  }
  if(path==='AI_CONTEXT.json'){
   try{
    const context=JSON.parse(source);
    for(const link of Object.values(context.entrypoints??{})){
     if(typeof link!=='string'){add(path,'INVALID_DOCUMENT_INDEX');continue;}
     const target=resolve(root,link);
     if(!inside(root,target))add(path,'EXTERNAL_DOCUMENT_LINK');
     else if(!existsSync(target))add(path,'MISSING_DOCUMENT_LINK');
    }
   }catch{add(path,'INVALID_DOCUMENT_INDEX');}
  }
 }
 return findings;
}

function exportedFiles(root,directory=root){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
 const path=resolve(directory,entry.name);if(entry.name==='.git')return [];
 return entry.isDirectory()?exportedFiles(root,path):[relative(root,path)];
});}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const exported=process.argv[2]==='--export';
 const root=exported?resolve(process.argv[3]??'.'):fileURLToPath(new URL('..',import.meta.url));
 const files=exported?exportedFiles(root):[...new Set(execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8',windowsHide:true}).split('\0').filter(Boolean))];
 const findings=auditPublicFiles(root,files);
 console.log(JSON.stringify({scope:exported?'exported_source':'tracked_and_unignored_source',files:files.length,passed:findings.length===0,findings},null,2));
 if(findings.length)process.exitCode=1;
}
