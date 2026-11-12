import './globals.css';
import './edition.css';
import './command-center.css';
import './paypal-theme.css';
import HackathonShell from '../components/HackathonShell';
export const metadata={title:'AgentPay | Your AI shops. You decide.',description:'Approve the exact purchase and check the PayPal Sandbox result. No live payments.',icons:{icon:'/favicon.ico'}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body><HackathonShell>{children}</HackathonShell></body></html>}
