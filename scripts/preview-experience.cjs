// Изолированный визуальный стенд: только синтетические данные, без IPC и рабочей базы.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const fixture=`
window.electronAPI=undefined;
saveData=async()=>{showToast('Предпросмотр: изменения не сохраняются');return false;};
const day=wfToday();
data={vehicles:[
 {id:'demo1',plate:'А 742 ТВ 72',make:'КамАЗ 43118',driver:'Александр Соколов',org:'ТВС',object:'Северный участок',status:'На ходу',fuel:'diesel',fuelGrade:'ДТ'},
 {id:'demo2',plate:'В 518 КМ 72',make:'Урал 4320',driver:'Сергей Волков',org:'ТВС',object:'База',status:'В резерве',fuel:'diesel',fuelGrade:'ДТ'},
 {id:'demo3',plate:'К 303 ВТ 72',make:'ГАЗель Next',driver:'Андрей Морозов',org:'ТВС',object:'Центральный участок',status:'В ремонте',fuel:'gasoline',fuelGrade:'АИ-92'},
 {id:'demo4',plate:'М 216 РК 72',make:'Toyota Hilux',driver:'Олег Орлов',org:'ТВС',object:'Северный участок',status:'На ходу',fuel:'diesel',fuelGrade:'ДТ'}
],records:[{id:'record1',vehicleId:'demo1',date:day,km:164,fuelIssued:65,fuelConsumed:51,fuelBalance:94}],generators:[{id:'gen1',name:'АД-100',location:'Северный участок',org:'ТВС',status:'В работе',fuel:'diesel',fuelGrade:'ДТ'}],genRecords:[],tanks:[],tankIncomes:[],vehicleTo:[],toRecords:[],repairs:[],fuelPurchases:[],payments:[{id:'payment1',date:day,dueDate:day,sum:158400,paidAmount:65000,contragent:'ООО «Север Сервис»',category:'Ремонт',description:'Ремонт гидросистемы',vehicleId:'demo3'}],contragents:[],budget:[],reestrRows:[]};
wfInitData(data);
data.drivers=[{id:'driver1',name:'Александр Соколов',skills:'C',site:'Северный участок'},{id:'driver2',name:'Сергей Волков',skills:'C',site:'База'},{id:'driver4',name:'Олег Орлов',skills:'B',site:'Северный участок'}];
data.dispatchJobs=[
 {id:'job1',title:'Доставка оборудования',status:'started',site:'Северный участок',org:'ТВС',start:day+'T07:00',end:day+'T14:30',assetRef:'v:demo1',driverId:'driver1',points:'База → Северный участок',plannedKm:180,actualKm:164,plannedHours:7.5,actualHours:5.2},
 {id:'job2',title:'Перевозка бригады',status:'assigned',site:'Северный участок',org:'ТВС',start:day+'T15:00',end:day+'T18:00',assetRef:'v:demo4',driverId:'driver4',points:'База → Вахтовый городок',plannedKm:96,plannedHours:3},
 {id:'job3',title:'Подвоз расходных материалов',status:'new',site:'Центральный участок',org:'ТВС',start:day+'T11:00',end:day+'T16:00',plannedKm:120,points:'Склад → Центральный участок'},
 {id:'job4',title:'Подача техники на базу',status:'done',site:'База',org:'ТВС',start:day+'T06:00',end:day+'T09:00',assetRef:'v:demo2',driverId:'driver2',plannedKm:65,actualKm:68,result:'Техника на базе'}
];
data.workOrders=[{id:'order1',assetRef:'v:demo3',title:'Ремонт гидросистемы',status:'repairing',site:'Центральный участок',downtimeFrom:day+'T08:00',description:'Замена шланга'}];
rebuildIndex();populateOrgSelect();updateFilterUI();
const previewSection=new URLSearchParams(location.search).get('section')||'home';
if(previewSection==='board'){wfOpenTab('dispatchJobs');}else if(previewSection==='timeline'){dxJobsView='timeline';wfOpenTab('dispatchJobs');}else if(previewSection==='dispatch'){wfOpenTab('overview');}else switchSection(previewSection);
const badge=document.createElement('div');badge.textContent='ПРЕДПРОСМОТР · ВЫМЫШЛЕННЫЕ ДАННЫЕ';badge.style.cssText='position:fixed;bottom:7px;left:8px;font:9px Segoe UI;letter-spacing:.05em;color:var(--text3);pointer-events:none;z-index:1';document.body.appendChild(badge);
`;
const mime={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json; charset=utf-8'};
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/preview-fixture.js'){res.writeHead(200,{'Content-Type':mime['.js']});return res.end(fixture);}
 const target=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
 const relative=path.relative(root,target);
 if(relative.startsWith('..')||path.isAbsolute(relative)||!['index.html','pdf-editor.html','reestr-window.html'].includes(relative)&&!relative.startsWith('assets'+path.sep)&&!relative.startsWith('vendor'+path.sep)){res.writeHead(404);return res.end();}
 try{let body=fs.readFileSync(target);if(relative==='index.html')body=body.toString().replace('<script src="assets/js/26-boot.js"></script>','<script src="/preview-fixture.js"></script>');res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);}catch{res.writeHead(404);res.end();}
}).listen(4173,'127.0.0.1',()=>process.stdout.write('Visual preview http://127.0.0.1:4173 · synthetic data only\n'));
