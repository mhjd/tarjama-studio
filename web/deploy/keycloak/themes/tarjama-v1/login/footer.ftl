<#macro content>
  <div class="tarjama-footer">
    <p>${msg("tarjamaPrivateSpace")}</p>
    <#if pageId == "register"><p>${msg("tarjamaRecoveryNotice")}</p></#if>
    <a href="/">${msg("tarjamaBackHome")}</a>
  </div>
</#macro>
