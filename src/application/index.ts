import type {ChangeRows,Database,Options,Persist,RepositoryPorts,RowResult,SavePorts} from './contracts';
import {createRepository} from './repository';
import {createSaveService} from './save-service';
import {createRowCommands} from './row-commands';
import {createCardController} from './card-controller';
import {createSetupController,type SetupPorts} from '../features/maintenance-setup/controller';
import {createSetupView,type DialogPort} from '../features/maintenance-setup/view';
export const apiVersion=1 as const;
export interface ApplicationPorts{repository:RepositoryPorts;save:SavePorts;persist(database:Database,options:Options):Promise<boolean>;semantic(command:unknown,options:Options):Promise<unknown>;trackRows(operation:Promise<RowResult>):Promise<RowResult>;allocateId(prefix:string):string;setup:SetupPorts;dialog:DialogPort}
/** Composition root. Features depend on ports, never on a window or storage adapter. */
export function createApplication(ports:ApplicationPorts){
 const repository=createRepository(ports.repository),saves=createSaveService(repository,ports.save),rows=createRowCommands(repository,saves,ports.persist);
 const commands=Object.freeze({saveSnapshot:(database:Database,options:Options|undefined,persist:Persist):Promise<boolean>=>saves.save(database,options,persist),semantic:(command:unknown,options:Options={}):Promise<unknown>=>ports.semantic(command,options),changeRows:(command:ChangeRows):Promise<RowResult>=>ports.trackRows(rows.execute(command))});
 const cards=createCardController(repository,commands.changeRows,ports.allocateId),maintenanceSetup=createSetupController(repository,createSetupView(ports.dialog),ports.setup);return Object.freeze({repository,commands,cards,maintenanceSetup});
}
export {createRepository,createSaveService,createRowCommands,createCardController,createSetupController};
