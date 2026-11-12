'use client';
import {useEffect,useState} from 'react';

export default function useSandboxAccess(){
 const [access,setAccess]=useState({ready:false,canWrite:false,unavailable:false});
 useEffect(()=>{
  const controller=new AbortController();
  void fetch('/api/sandbox/config',{cache:'no-store',signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error('unavailable');const config=await response.json();
   if(!controller.signal.aborted)setAccess({ready:true,canWrite:config.readOnly===false,unavailable:false});
  }).catch(()=>{if(!controller.signal.aborted)setAccess({ready:true,canWrite:false,unavailable:true});});
  return()=>controller.abort();
 },[]);
 return access;
}
