import {requirePageSession,type PageQuery} from '../../../server/require-page-session';
import TransactionDetail from '../../../components/TransactionDetail';
export default async function Page({params,searchParams}:{params:Promise<{purchaseId:string}>;searchParams:PageQuery}){const {purchaseId}=await params;await requirePageSession(`/transactions/${encodeURIComponent(purchaseId)}`,searchParams);return <TransactionDetail purchaseId={purchaseId}/>;}
