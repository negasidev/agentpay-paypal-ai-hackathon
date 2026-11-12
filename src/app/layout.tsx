import './globals.css';
import './edition.css';
import './command-center.css';
import './paypal-theme.css';
import HackathonShell from '../components/HackathonShell';
export const metadata={title:'AgentPay | Hackathon Edition',description:'AI-assisted commerce, exact-term human review and verifiable PayPal sandbox evidence.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body><HackathonShell>{children}</HackathonShell></body></html>}
