import {requirePageSession,type PageQuery} from '../../server/require-page-session';
import ProblemDemo from '../../components/ProblemDemo';
export default async function Page({searchParams}:{searchParams:PageQuery}){await requirePageSession("/assistant",searchParams);return <ProblemDemo/>}
