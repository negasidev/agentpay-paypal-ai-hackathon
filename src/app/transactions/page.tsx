import {requirePageSession,type PageQuery} from '../../server/require-page-session';
import Workspace from '../../components/Workspace';
export default async function Page({searchParams}:{searchParams:PageQuery}){
 await requirePageSession('/transactions',searchParams);
 const query=await searchParams;
 const selected=typeof query.purchase==='string'?query.purchase:query.purchase===undefined?undefined:'';
 return <Workspace view="Transactions" selectedPurchase={selected}/>;
}
