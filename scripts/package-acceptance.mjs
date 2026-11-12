import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,readdirSync,lstatSync,existsSync,unlinkSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {auditPublicFiles} from './public-boundary.mjs';

// Committed bytes exclude concurrent working-tree edits and local credentials.
const args=process.argv.slice(2),[commit,destination]=args;
if(args.length!==2||!/^[a-f0-9]{40}$/.test(commit??'')||!destination)throw Error('EXACT_COMMITS_AND_NEW_DESTINATION_REQUIRED');
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..'),output=resolve(destination);
if(output===repository||output.startsWith(repository+'/')||output.startsWith(repository+'\\'))throw Error('DESTINATION_MUST_BE_OUTSIDE_SOURCE');
const archive=execFileSync('git',['-C',repository,'-c','core.autocrlf=false','archive','--format=tar',commit],{maxBuffer:64*1024*1024,windowsHide:true});
mkdirSync(output,{recursive:false});
const archiveFile=join(output,'source.tar');writeFileSync(archiveFile,archive,{flag:'wx'});
execFileSync('tar',['-xf',archiveFile,'-C',output],{windowsHide:true});unlinkSync(archiveFile);
const sources=[];
function scan(directory){for(const name of readdirSync(directory).sort()){
 const path=join(directory,name),stat=lstatSync(path);
 if(stat.isSymbolicLink())throw Error('RELEASE_SYMLINK_REFUSED');
 if(stat.isDirectory()){if(['.git','node_modules','.next','data','.artifacts'].includes(name))throw Error('PRIVATE_RELEASE_INPUT_REFUSED');scan(path);continue;}
 if((name.startsWith('.env')&&!['.env.example','.env.hosted.example'].includes(name))||/\.(pem|pfx|p12|key)$/i.test(name))throw Error('PRIVATE_RELEASE_INPUT_REFUSED');
 sources.push({path:path.slice(output.length+1).replaceAll('\\','/'),sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});
}}
scan(output);
const boundary=auditPublicFiles(output,sources.map(source=>source.path));
if(boundary.length){console.error(JSON.stringify({passed:false,findings:boundary}));throw Error('PUBLIC_SOURCE_BOUNDARY_REFUSED');}
for(const required of ['Dockerfile','compose.yaml','package.json','vendor/agent-sdk/package.json','migrations/015_reference_merchant_orders.sql','scripts/verify-acceptance.mjs'])
 if(!existsSync(join(output,required)))throw Error('COMMITTED_ACCEPTANCE_INPUTS_MISSING');
writeFileSync(join(output,'release-inputs.json'),JSON.stringify({scope:'standalone_committed_source_not_deployed',commit,sources},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'EXPORTED_NOT_DEPLOYED',commit,files:sources.length}));
