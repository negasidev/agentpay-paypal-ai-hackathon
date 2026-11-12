import {requirePageSession} from '../../server/require-page-session';
import ProblemDemo from '../../components/ProblemDemo';
export default async function Page(){await requirePageSession('/demo');return <ProblemDemo/>;}
