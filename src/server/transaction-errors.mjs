export function transactionFailure(error,logger=console){
 const code=error?.code??error?.message;
 if(code==='UNAUTHENTICATED')return {status:401,body:{error:'Sign in required'}};
 if(code==='NOT_FOUND')return {status:404,body:{error:'Transaction unavailable'}};
 const category=['42P01','42703'].includes(code)?'database_schema':
  ['08006','53300','57P01','ECONNREFUSED','ETIMEDOUT'].includes(code)?'database_unavailable':
  code==='HACKATHON_HOSTING_CONFIGURATION_REFUSED'?'hosting_configuration':'service_unavailable';
 // Provider and SQL errors may contain identities or credentials. Log only a
 // bounded category while keeping the public response independent of details.
 logger.error({event:'transaction_detail_unavailable',category});
 return {status:503,body:{error:'Transaction unavailable'}};
}
