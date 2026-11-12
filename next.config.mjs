import {fileURLToPath} from 'node:url';
export default {
 output:'standalone',
 outputFileTracingRoot:fileURLToPath(new URL('.',import.meta.url)),
 async headers(){return[
  {source:'/:path*',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'X-Frame-Options',value:'DENY'},{key:'Referrer-Policy',value:'no-referrer'}]},
  {source:'/api/:path*',headers:[{key:'Cache-Control',value:'private, no-store, max-age=0'},{key:'Vary',value:'Cookie'}]}
 ];}
};
