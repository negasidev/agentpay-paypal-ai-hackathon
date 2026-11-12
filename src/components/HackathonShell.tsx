'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useState} from 'react';
const links=[['Overview','/'],['AI workspace','/assistant'],['Authorization','/approvals'],['Sandbox checkout','/checkout'],['Evidence','/transactions']];
export default function HackathonShell({children}:{children:React.ReactNode}){
 const path=usePathname(),[open,setOpen]=useState(false);
 return <div className="edition"><a className="skip" href="#main">Skip to workspace</a><header className="wallet-header"><div className="wallet-header-inner"><Link className="brand" href="/">AgentPay<span>HACKATHON EDITION</span></Link><button className="wallet-menu" aria-expanded={open} aria-controls="edition-sidebar" onClick={()=>setOpen(!open)}>Menu</button><nav id="edition-sidebar" className={open?'wallet-nav open':'wallet-nav'} aria-label="Workspace">{links.map(([label,href])=><Link key={href} href={href} aria-current={path===href?'page':undefined} onClick={()=>setOpen(false)}>{label}</Link>)}</nav><Link className="wallet-login" href="/sign-in">Account sign in</Link></div></header><div className="application"><div className="wallet-context"><span>PayPal Sandbox only</span><Link href="/hackathon#judge-access">Problem & solution demo →</Link></div><main id="main" tabIndex={-1}>{children}</main><footer><strong>AgentPay · Hackathon Edition</strong><p>AI proposes. Humans authorize. No production payments.</p><Link href="/hackathon">Setup &amp; scope</Link></footer></div></div>;
}
