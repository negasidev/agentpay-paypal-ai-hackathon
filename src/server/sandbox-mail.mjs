import nodemailer from 'nodemailer';
const address=value=>typeof value==='string'&&value.length<=254&&/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(value);
export function mailConfiguration(env=process.env){
 if(env.AGENTPAY_EDITION!=='hackathon'||env.PAYPAL_ENVIRONMENT!=='sandbox'||env.AGENTPAY_EMAIL_PROFILE!=='isolated-sandbox'||!address(env.AGENTPAY_SANDBOX_SMTP_USER)||!env.AGENTPAY_SANDBOX_SMTP_PASSWORD)throw Error('SANDBOX_EMAIL_NOT_CONFIGURED');
 const allowed=env.AGENTPAY_EMAIL_ALLOWED_RECIPIENTS?.trim()?env.AGENTPAY_EMAIL_ALLOWED_RECIPIENTS.split(',').map(x=>x.trim().toLowerCase()):null;
 if(allowed?.some(x=>!address(x)))throw Error('SANDBOX_EMAIL_NOT_CONFIGURED');
 return {sender:env.AGENTPAY_SANDBOX_SMTP_USER,allowed,transport:{host:'smtp.hostinger.com',port:587,secure:false,requireTLS:true,auth:{user:env.AGENTPAY_SANDBOX_SMTP_USER,pass:env.AGENTPAY_SANDBOX_SMTP_PASSWORD},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},maxRecipients:1,connectionTimeout:5000,greetingTimeout:5000,socketTimeout:10000,disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false}};
}
export async function sendSandboxMail(to,subject,text,{env=process.env,createTransport=nodemailer.createTransport}={}){
 const config=mailConfiguration(env);if(!address(to)||config.allowed&&!config.allowed.includes(to.toLowerCase())||!['Verify your AgentPay Sandbox email','Review your AgentPay Sandbox purchase'].includes(subject)||typeof text!=='string'||text.length>8000)throw Error('SANDBOX_EMAIL_REFUSED');
 const transport=createTransport(config.transport);try{const sent=await transport.sendMail({from:config.sender,to,subject,text,disableFileAccess:true,disableUrlAccess:true});if(!sent.accepted?.some(x=>x.toLowerCase()===to.toLowerCase())||sent.rejected?.length)throw Error('SANDBOX_EMAIL_FAILED');return {state:'SUBMITTED',providerId:typeof sent.messageId==='string'?sent.messageId.slice(0,200):null};}finally{transport.close();}
}
