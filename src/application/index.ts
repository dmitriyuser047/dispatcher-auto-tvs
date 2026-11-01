import {errorOf,type ChangeRows,type Database,type Options,type Persist,type RepositoryPorts,type RowResult,type SavePorts} from './contracts';
import {createRepository} from './repository';
import {createSaveService} from './save-service';
import {createRowCommands} from './row-commands';
import {createCardController} from './card-controller';
import {createSetupController,type SetupPorts} from '../features/maintenance-setup/controller';
import {createSetupView,type DialogPort} from '../features/maintenance-setup/view';
export const apiVersion=1 as const;
export interface ApplicationPorts{repository:RepositoryPorts;save:SavePorts;persist(database:Database,options:Options):Promise<boolean>;prepareRows?():Promise<void>;semantic(command:unknown,options:Options):Promise<unknown>;trackRows(operation:Promise<RowResult>):Promise<RowResult>;allocateId(prefix:string):string;setup:SetupPorts;dialog:DialogPort}
/** Composition root. Features depend on ports, never on a window or storage adapter. */
export function createApplication(ports:ApplicationPorts){
 const repository=createRepository(ports.repository),saves=createSaveService(repository,ports.save),rows=createRowCommands(repository,saves,ports.persist);
 const commands=Object.freeze({saveSnapshot:(database:Database,options:Options|undefined,persist:Persist):Promise<boolean>=>saves.save(database,options,persist),semantic:(command:unknown,options:Options={}):Promise<unknown>=>ports.semantic(command,options),changeRows:(command:ChangeRows):Promise<RowResult>=>ports.trackRows(ports.prepareRows?ports.prepareRows().then(()=>rows.execute(command)).catch((error:unknown):RowResult=>({ok:false,...errorOf(error)})):rows.execute(command))});
 const cards=createCardController(repository,commands.changeRows,ports.allocateId),maintenanceSetup=createSetupController(repository,createSetupView(ports.dialog),ports.setup);return Object.freeze({repository,commands,cards,maintenanceSetup});
}
export {createRepository,createSaveService,createRowCommands,createCardController,createSetupController};
