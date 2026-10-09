'use strict';
const grant=document.querySelector('#grant'),back=document.querySelector('#back'),status=document.querySelector('#status');
const permission={origins:['<all_urls>']};
function showGranted(){status.textContent='Autorização concedida. Volte à página, clique em Lens e selecione a área novamente. Nenhuma imagem foi capturada aqui.';grant.disabled=true;back.textContent='Voltar à página';}
chrome.permissions.contains(permission).then(allowed=>{if(allowed)showGranted();else{grant.disabled=false;status.textContent='O Lens aguarda sua autorização. TTS e STT continuam funcionando sem ela.';}}).catch(()=>{grant.disabled=false;status.textContent='Não foi possível verificar a autorização. Você pode tentar autorizar pelo botão acima.';});
grant.addEventListener('click',()=>{
    // Chamada direta no gesto da página da extensão: nenhum await/mensagem antes.
    grant.disabled=true;
    try {
        chrome.permissions.request(permission).then(allowed=>{
            if(allowed)showGranted();
            else{grant.disabled=false;status.textContent='Permissão não concedida. Nenhuma imagem foi capturada. Você pode voltar sem alterar suas configurações ou tentar novamente.';}
        }).catch(()=>{grant.disabled=false;status.textContent='Não foi possível autorizar a captura. Tente novamente pelo botão ou volte à página sem alterar suas configurações.';});
    }catch{grant.disabled=false;status.textContent='Não foi possível solicitar autorização. Tente novamente pelo botão.';}
});
back.addEventListener('click',async()=>{
    const id=new URL(location.href).searchParams.get('tabId');
    if(!/^[1-9]\d*$/.test(id||'')){status.textContent='Volte à página desejada pela barra de abas do Chrome e tente o Lens novamente.';return;}
    try{await chrome.tabs.update(Number(id),{active:true});}catch{status.textContent='A aba original foi fechada. Abra uma página compatível e clique em Lens.';}
});
