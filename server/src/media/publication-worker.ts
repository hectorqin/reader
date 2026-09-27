import {parentPort,workerData} from 'node:worker_threads';
import {MediaStoreDatabase} from './store-database.ts';
import {MediaStatementDatabase} from './statement-database.ts';
import {MediaLibraries} from './libraries.ts';
import {MediaCatalog} from './catalog.ts';
import {MediaPublisher} from './publisher.ts';

const db=new MediaStoreDatabase(workerData.path);
const executor=new MediaStatementDatabase(db);
try{
  const libraries=new MediaLibraries(db,false),catalog=new MediaCatalog(executor,libraries,false);
  parentPort!.postMessage({state:'started'});
  new MediaPublisher(executor,catalog).publish(workerData.libraryId,workerData.jobId);
  parentPort!.postMessage({state:'committed'});
}finally{executor.clear();db.close();}
