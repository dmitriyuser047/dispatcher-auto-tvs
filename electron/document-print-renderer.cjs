'use strict';
const {createSafeHtmlPdfRenderer}=require('./safe-html-pdf.cjs');
function createDocumentPrintRenderer({BrowserWindow,session,engine=()=>require('../assets/core/document-print.js'),timeoutMs=30000}={}){
 const render=createSafeHtmlPdfRenderer({BrowserWindow,session,timeoutMs});
 return async function renderPdf(snapshot,assertCurrent){const print=engine();print.verify(snapshot);const html=print.render(snapshot).html;if(typeof html!=='string'||!/<head(?:\s[^>]*)?>/i.test(html))throw Error('У печатной формы отсутствует заголовок');return render(html,{landscape:false,pageSize:'A4',preferCSSPageSize:true},assertCurrent);};
}
module.exports=Object.freeze({createDocumentPrintRenderer});
