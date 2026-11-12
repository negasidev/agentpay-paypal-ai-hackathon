import {requirePageSession,type PageQuery} from '../../server/require-page-session';
import Workspace from '../../components/Workspace';
export default async function Page({searchParams}:{searchParams:PageQuery}){
 await requirePageSession('/checkout',searchParams);
 return <Workspace view="Checkout"/>;
}
