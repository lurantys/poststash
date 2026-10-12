(() => {
  const hostId = 'ig-saver-page-button';
  const reserved = new Set(['about','accounts','developer','direct','emails','explore','legal','p','privacy','reel','reels','stories','tv','web']);
  let pollingJob = false, lastOpenedItem = null, lastProfileUsername = null, scheduled = false;

  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.source !== 'ig-saver' || event.data?.type !== 'progress') return;
    chrome.runtime.sendMessage({...event.data,type:'download-progress'}).catch(()=>{});
    const button=document.querySelector(`#${hostId}`)?.shadowRoot?.querySelector('button');
    if(button && ['scanning','waiting'].includes(event.data.stage)){button.dataset.state='loading';button.disabled=true;button.querySelector('.label').textContent=event.data.stage==='waiting'?'Waiting for profile media...':`Scanning - page ${event.data.pages} - ${event.data.items} found`;}
  });
  window.addEventListener('message',event=>{if(event.source===window&&event.origin===location.origin&&event.data?.source==='poststash-story-frame'&&event.data?.type==='changed')scheduleMount();});
  chrome.runtime.onMessage.addListener(message=>{if(message?.type==='ig-saver-job-started')pollJob();});

  function currentUsername(){const p=location.pathname.split('/').filter(Boolean);return p.length===1&&!reserved.has(p[0].toLowerCase())?p[0]:null;}
  function findName(){const main=document.querySelector('main');if(!main)return null;return [...main.querySelectorAll('h1,h2')].find(n=>n.getClientRects().length&&n.textContent.trim())||null;}
  function downloadIcon(label,onClick){
    const host=document.createElement('span');host.className='poststash-control';host.style.cssText='display:inline-flex;align-items:center;vertical-align:middle;margin:0 5px;position:relative;z-index:2147483000;';
    const shadow=host.attachShadow({mode:'open'}),button=document.createElement('button');button.type='button';button.setAttribute('aria-label',label);button.title=label;
    button.innerHTML='<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 16v4h14v-4"/></svg>';
    button.style.cssText='all:unset;box-sizing:border-box;display:grid;place-items:center;width:40px;height:40px;border-radius:50%;color:inherit;background:rgba(128,128,128,.16);cursor:pointer;';
    button.addEventListener('mouseenter',()=>button.style.background='rgba(128,128,128,.3)');button.addEventListener('mouseleave',()=>button.style.background='rgba(128,128,128,.16)');
    let resetTimer=0;button.addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();clearTimeout(resetTimer);button.disabled=true;button.style.opacity='.55';button.innerHTML='<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke-dasharray="30 20"/></svg>';try{await onClick(button);button.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';button.title=label;button.setAttribute('aria-label',label);resetTimer=setTimeout(()=>{button.innerHTML='<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 16v4h14v-4"/></svg>';},1500);}catch(error){const message=/extension context invalid|context invalidated/i.test(error?.message||'')?'Extension reloaded. Refresh this Instagram tab, then try again.':error.message||'Download failed';button.title=message;button.setAttribute('aria-label',label);button.innerHTML='<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 16v4h14v-4"/></svg>';}finally{button.disabled=false;button.style.opacity='1';}});
    shadow.append(button);return host;
  }
  function itemFromPage(){const p=location.pathname.split('/').filter(Boolean);if(['p','reel','tv'].includes(p[0])&&p[1])return{group:p[1],category:p[0]==='p'?'posts':'reels'};const d=document.querySelector('[role="dialog"]'),a=d?.querySelector('a[href*="/p/"],a[href*="/reel/"],a[href*="/tv/"]');if(a){const m=a.pathname.match(/\/(p|reel|tv)\/([^/]+)/);if(m)return{group:m[2],category:m[1]==='p'?'posts':'reels'};}return lastOpenedItem;}
  function mountPostDownload(){
    const dialog=document.querySelector('[role="dialog"]'),item=itemFromPage(),old=document.getElementById('poststash-post-download');
    if(!dialog){old?.remove();return;}
    const buttons=[...dialog.querySelectorAll('button,[role="button"]')].filter(el=>el.getClientRects().length);
    let anchor=buttons.find(el=>/^(like|unlike)$/i.test(el.getAttribute('aria-label')||el.title||''));
    if(!anchor){
      const box=dialog.getBoundingClientRect(),footerButtons=buttons.filter(el=>{const r=el.getBoundingClientRect();return r.left>box.left+box.width*.52&&r.left<box.left+box.width*.84&&r.top>box.top+box.height*.82&&r.bottom<box.bottom-24;});
      footerButtons.sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top);
      anchor=footerButtons[0];
    }
    if(!anchor)return;const row=anchor.parentElement;if(!row||row.querySelector('#poststash-post-download'))return;old?.remove();
    const host=downloadIcon('Download post or Reel',async button=>{const current=itemFromPage()||item;const result=await chrome.runtime.sendMessage({type:'download-viewer-media',group:current?.group||'',category:current?.category||'posts',username:lastProfileUsername||currentUsername()});if(!result?.ok)throw new Error(result?.message||'Download failed');button.title=result.message||'Media downloaded';});host.id='poststash-post-download';anchor.insertAdjacentElement('afterend',host);
  }
  let storyControl = null;
  function removeStoryControl(){
    if(!storyControl)return;
    storyControl.host.remove();
    if(storyControl.positionChanged && storyControl.frame.style.position==='relative')storyControl.frame.style.position=storyControl.originalPosition;
    storyControl=null;
  }
  function mountStoryDownload(){
    const media=document.querySelector('[data-poststash-story-active]');
    if(!media||!media.isConnected){removeStoryControl();return;}
    const version=media.getAttribute('data-poststash-story-active'),token=media.getAttribute('data-poststash-story-media');
    const category=media.getAttribute('data-poststash-story-category')||'stories';
    const r=media.getBoundingClientRect();
    if(r.width<120||r.height<120){removeStoryControl();return;}
    let frame=null;
    for(let parent=media.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
      const box=parent.getBoundingClientRect();
      if(box.width>=r.width-2&&box.height>=r.height-2&&box.width<=r.width*1.25&&box.height<=r.height*1.25){frame=parent;break;}
    }
    frame ||= media.parentElement;
    if(!frame){removeStoryControl();return;}
    if(storyControl?.version!==version||storyControl?.media!==media||storyControl?.frame!==frame){
      removeStoryControl();
      const activePath=location.pathname.split('/').filter(Boolean),highlight=category==='highlights';
      const username=highlight?(activePath[3]||lastProfileUsername||'instagram'):activePath[1]||lastProfileUsername||'instagram';
      const host=downloadIcon(highlight?'Download highlight':'Download story',async button=>{
        if(!host.isConnected||media.getAttribute('data-poststash-story-active')!==version)throw new Error('This Story changed. Use the download button in the current Story frame.');
        const storyClickId=host.dataset.storyClickId;
        if(!storyClickId)throw new Error('The Story click could not be captured. Try the current Story button again.');
        const result=await chrome.runtime.sendMessage({type:'download-viewer-media',category,username,storyClickId});
        if(!result?.ok)throw new Error(result?.message||'Could not download this Story.');
        button.title=result.message||'Story saved';
      });
      host.id='poststash-story-download';
      host.setAttribute('data-poststash-story-button',version);
      host.dataset.storyMediaToken=token;host.dataset.storyCategory=category;host.dataset.storyUsername=username;
      const fixed=frame===document.body||frame===document.documentElement;
      const originalPosition=frame.style.position;
      const positionChanged=!fixed&&getComputedStyle(frame).position==='static';
      if(positionChanged)frame.style.position='relative';
      host.style.cssText='display:block;position:'+ (fixed?'fixed':'absolute')+';margin:0;z-index:2147483000;color:white;pointer-events:auto;';
      const button=host.shadowRoot.querySelector('button');
      button.style.color='white';button.style.background='rgba(0,0,0,.7)';
      button.addEventListener('mouseenter',()=>button.style.background='rgba(0,0,0,.85)');
      button.addEventListener('mouseleave',()=>button.style.background='rgba(0,0,0,.7)');
      button.addEventListener('focus',()=>{button.style.outline='2px solid white';button.style.outlineOffset='2px';});
      button.addEventListener('blur',()=>button.style.outline='');
      frame.append(host);
      storyControl={host,media,frame,version,fixed,positionChanged,originalPosition};
    }
    const box=storyControl.fixed?{left:0,top:0}:frame.getBoundingClientRect();
    const left=Math.max(0,r.right-box.left-52-(storyControl.fixed?0:frame.clientLeft));
    const top=Math.max(0,r.top-box.top+60-(storyControl.fixed?0:frame.clientTop));
    if(storyControl.host.style.left!==`${left}px`)storyControl.host.style.left=`${left}px`;
    if(storyControl.host.style.top!==`${top}px`)storyControl.host.style.top=`${top}px`;
  }
  document.addEventListener('click',event=>{const target=event.target instanceof Element?event.target:null,a=target?.closest('a[href*="/p/"],a[href*="/reel/"],a[href*="/tv/"]');if(a){const m=a.pathname.match(/\/(p|reel|tv)\/([^/]+)/);if(m)lastOpenedItem={group:m[2],category:m[1]==='p'?'posts':'reels'};}},true);

  function mount(){
    mountPostDownload();mountStoryDownload();const username=currentUsername(),existing=document.getElementById(hostId);
    if(!username){existing?.remove();return;}lastProfileUsername=username;const name=findName();if(!name)return;
    if(existing?.dataset.username===username){if(!existing.isConnected)name.insertAdjacentElement('afterend',existing);return;}existing?.remove();
    const host=document.createElement('span');host.id=hostId;host.dataset.username=username;host.style.cssText='display:inline-flex;vertical-align:middle;margin:8px 0 8px 12px;';
    const shadow=host.attachShadow({mode:'open'}),style=document.createElement('style');style.textContent='@keyframes spin{to{transform:rotate(360deg)}}.spinner{display:none;width:12px;height:12px;flex:0 0 auto;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .8s linear infinite}button[data-state="loading"] .spinner{display:block}button[data-state="loading"]{opacity:.65;cursor:wait}.label{overflow-wrap:anywhere;text-align:center}@media(prefers-color-scheme:dark){button{background:#363636!important;color:#f5f5f5!important}button:hover{background:#484848!important}}';
    const button=document.createElement('button');button.type='button';button.setAttribute('aria-live','polite');button.setAttribute('aria-busy','false');button.innerHTML='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 16v4h14v-4"/></svg><span class="spinner" aria-hidden="true"></span><span class="label">Download all media</span>';
    button.style.cssText='all:unset;box-sizing:border-box;display:inline-flex;min-height:34px;align-items:center;justify-content:center;gap:7px;padding:0 13px;border-radius:8px;background:#efefef;color:#262626;font:600 12px/1.2 "Instagram Sans",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;cursor:pointer;white-space:normal;';
    button.addEventListener('mouseenter',()=>{if(!button.disabled)button.style.background='#dbdbdb';});button.addEventListener('mouseleave',()=>button.style.background='#efefef');button.addEventListener('focus',()=>{button.style.outline='2px solid #0095f6';button.style.outlineOffset='2px';});button.addEventListener('blur',()=>{button.style.outline='';button.style.outlineOffset='';});shadow.append(style,button);name.insertAdjacentElement('afterend',host);
    button.addEventListener('click',async()=>{button.disabled=true;button.dataset.state='loading';button.setAttribute('aria-busy','true');button.querySelector('.label').textContent='Starting...';try{const r=await chrome.runtime.sendMessage({type:'download-profile'});if(!r?.ok)throw new Error(r?.message||'Download could not start');button.querySelector('.label').textContent='Scanning profile...';pollJob();}catch(e){button.dataset.state='error';button.querySelector('.label').textContent=e.message||'Download could not start';}finally{if(!pollingJob){button.disabled=false;button.dataset.state='';button.setAttribute('aria-busy','false');}}});
  }
  async function pollJob(){if(pollingJob)return;pollingJob=true;try{while(true){const username=currentUsername();if(!username)return;try{const response=await chrome.runtime.sendMessage({type:'get-download-progress'}),job=response?.progress,button=document.querySelector(`#${hostId}`)?.shadowRoot?.querySelector('button');if(!job||job.username&&job.username.toLowerCase()!==username.toLowerCase())return;if(job.stage==='scanning')setButtonProgress(button,`Scanning - page ${job.pages} - ${job.items||0} found`,true);else if(job.stage==='waiting')setButtonProgress(button,'Waiting for profile media...',true);else if(job.stage==='downloading')setButtonProgress(button,`Downloading ${job.downloaded}/${job.total}`,true);else if(job.stage==='complete'){setButtonProgress(button,job.failed?`Done - ${job.failed} failed to start`:`Done - ${job.downloaded} downloads started`,false,job.message);return;}else if(job.stage==='error'){setButtonProgress(button,job.error||'Download failed.',false);return;}}catch{return;}await new Promise(r=>setTimeout(r,1000));}}finally{pollingJob=false;}}
  function setButtonProgress(button,text,loading,title=''){if(!button)return;button.querySelector('.label').textContent=text;button.dataset.state=loading?'loading':'done';button.disabled=loading;button.setAttribute('aria-busy',loading?'true':'false');button.title=title||text;}
  function scheduleMount(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;mount();});}
  const observer=new MutationObserver(scheduleMount);observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['data-poststash-story-active','src','poster']});
  window.addEventListener('resize',scheduleMount);window.addEventListener('scroll',scheduleMount,true);
  window.addEventListener('popstate',scheduleMount);const push=history.pushState;history.pushState=function(...args){const r=push.apply(this,args);scheduleMount();return r;};
  setInterval(scheduleMount,1200);mount();
})();
