'use client';
import {useEffect} from 'react';

// Older phone builds transfer private share input in a fragment. Consume it
// locally before sign-in; copying it to a route or query would expose it in logs.
export default function useSharedDraft(){useEffect(()=>{
 const fragment=window.location.hash.slice(1);
 if(!fragment)return;
 if(fragment.length<=6000&&new URLSearchParams(fragment).has('request')){
  try{sessionStorage.setItem('agentpay.shared-draft',fragment);}catch{}
 }
 window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);
},[]);}
