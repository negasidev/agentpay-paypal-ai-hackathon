import SandboxRegistration from '../../components/SandboxRegistration';
import {registrationConfiguration} from '../../server/sandbox-registration.mjs';
import {mailConfiguration} from '../../server/sandbox-mail.mjs';
export const dynamic='force-dynamic';
export default function Page(){let available=false;try{registrationConfiguration();mailConfiguration();available=true;}catch{}return <SandboxRegistration available={available}/>;}
