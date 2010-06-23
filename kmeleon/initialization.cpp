/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Adblock Plus.
 *
 * The Initial Developer of the Original Code is
 * Wladimir Palant.
 * Portions created by the Initial Developer are Copyright (C) 2006-2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

#include "adblockplus.h"
 
abpToolbarDataList toolbarList;
abpStatusBarList statusbarList;
nsCOMPtr<nsIDOMWindowInternal> fakeBrowserWindow;
WORD cmdBase = 0;
char labelValues[NUM_LABELS][100];

char* context_labels[] = {
  "context.image...",
  "context.object...",
  "context.frame...",
};

PRBool Load() {
  nsresult rv;

  kFuncs = kPlugin.kFuncs;

  abpJSContextHolder contextHolder;
  JSContext* cx = contextHolder.get();
  if (cx == nsnull)
    return PR_FALSE;

  nsCOMPtr<nsIScriptSecurityManager> secman = do_GetService(NS_SCRIPTSECURITYMANAGER_CONTRACTID);
  if (secman == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to retrieve security manager - wrong Gecko version?");
    return PR_FALSE;
  }

  nsCOMPtr<nsIPrincipal> systemPrincipal;
  rv = secman->GetSystemPrincipal(getter_AddRefs(systemPrincipal));
  if (NS_FAILED(rv) || systemPrincipal == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to retrieve system's security principal");
    return PR_FALSE;
  }

  JSObject* jsObject = GetComponentObject(cx);
  if (jsObject == nsnull)
    return PR_FALSE;

  if (!CreateFakeBrowserWindow(cx, JS_GetParent(cx, jsObject), systemPrincipal))
    return PR_FALSE;

  cmdBase = kFuncs->GetCommandIDs(NUM_COMMANDS);
  toolbarList.init(cmdBase + CMD_TOOLBAR);
  statusbarList.init(hImages, cmdBase + CMD_STATUSBAR, kFuncs->AddStatusBarIcon, kFuncs->RemoveStatusBarIcon);

  return PR_TRUE;
}

/********************
 * Helper functions *
 ********************/

JSObject* GetComponentObject(JSContext* cx) {
  nsCOMPtr<nsISupports> abp = do_CreateInstance(ADBLOCKPLUS_CONTRACTID);
  if (abp == nsnull) {
    // Maybe the component isn't registered yet? Try registering it.
    nsresult rv;

    nsCOMPtr<nsIComponentRegistrar> compReg;
    rv = NS_GetComponentRegistrar(getter_AddRefs(compReg));
    if (NS_FAILED(rv) || compReg == nsnull) {
      JS_ReportError(cx, "Adblock Plus: Failed to retrieve component registrar - wrong Gecko version?");
      return nsnull;
    }

    nsCOMPtr<nsIProperties> dirService = do_GetService("@mozilla.org/file/directory_service;1");
    if (dirService == nsnull) {
      JS_ReportError(cx, "Adblock Plus: Failed to retrieve directory service - wrong Gecko version?");
      return nsnull;
    }

    nsCOMPtr<nsILocalFile> compFile;
    rv = dirService->Get(NS_XPCOM_COMPONENT_DIR, NS_GET_IID(nsILocalFile), getter_AddRefs(compFile));
    if (NS_FAILED(rv)) {
      JS_ReportError(cx, "Adblock Plus: Failed to retrieve components directory");
      return nsnull;
    }

    compFile->AppendRelativePath(NS_LITERAL_STRING("AdblockPlus.js"));
    rv = compReg->AutoRegister(compFile);
    if (NS_FAILED(rv)) {
      JS_ReportError(cx, "Adblock Plus: Failed to register AdblockPlus.js");
      return nsnull;
    }

    abp = do_CreateInstance(ADBLOCKPLUS_CONTRACTID);
  }
  if (abp == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to retrieve Adblock Plus component");
    return nsnull;
  }

  JSObject* jsObject = UnwrapJSObject(abp);
  if (jsObject == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed extracting JavaScript object from Adblock Plus component");
    return nsnull;
  }

  return jsObject;
}
 
PRBool CreateFakeBrowserWindow(JSContext* cx, JSObject* parent, nsIPrincipal* systemPrincipal) {
  nsresult rv;
  jsval value;

  nsCOMPtr<nsIXPConnect> xpc = do_GetService(nsIXPConnect::GetCID());
  if (xpc == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Coult not retrieve nsIXPConnect - wrong Gecko version?");
    return PR_FALSE;
  }
  rv = xpc->FlagSystemFilenamePrefix("adblockplus.dll/");
  if (NS_FAILED(rv)) {
    JS_ReportError(cx, "Adblock Plus: Failed to enable protection for inline JavaScript");
    return PR_FALSE;
  }

  JSObject* obj = JS_NewObject(cx, nsnull, nsnull, parent);
  if (obj == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to create fake browser window object - out of memory?");
    return PR_FALSE;
  }
  JS_SetGlobalObject(cx, obj);

  // Have to loop through the methods manually because JS_DefineFunctions won't do anything for some reason
  for (JSFunctionSpec *fs = window_methods; fs->name; fs++) {
    JSFunction *fun = JS_DefineFunction(cx, obj, fs->name, fs->call, fs->nargs, fs->flags);
    if (!fun) {
      JS_ReportError(cx, "Adblock Plus: Failed to attach native methods to fake browser window");
      return PR_FALSE;
    }
  }

  if (!JS_DefineProperties(cx, obj, window_properties)) {
    JS_ReportError(cx, "Adblock Plus: Failed to attach native properties to fake browser window");
    return PR_FALSE;
  }

  JSPrincipals* principals;
  rv = systemPrincipal->GetJSPrincipals(cx, &principals);
  if (NS_FAILED(rv)) {
    JS_ReportError(cx, "Adblock Plus: Could not convert system principal into JavaScript principals");
    return PR_FALSE;
  }

  for (int i = 0; includes[i]; i += 2) {
    JSScript* inlineScript = JS_CompileScriptForPrincipals(cx, obj, principals, includes[i+1], strlen(includes[i+1]), includes[i], 1);
    if (inlineScript == nsnull) {
      JS_ReportError(cx, "Adblock Plus: Failed to compile %s", includes[i]);
      return PR_FALSE;
    }

    if (!JS_ExecuteScript(cx, obj, inlineScript, &value)) {
      JS_ReportError(cx, "Adblock Plus: Failed to execute %s", includes[i]);
      return PR_FALSE;
    }
    JS_DestroyScript(cx, inlineScript);
  }
  JSPRINCIPALS_DROP(cx, principals);

  nsCOMPtr<nsISupports> wrapped;
  rv = xpc->WrapJS(cx, obj, NS_GET_IID(nsISupports), getter_AddRefs(wrapped));
  if (NS_FAILED(rv)) {
    JS_ReportError(cx, "Adblock Plus: Failed to create XPConnect wrapper for fake browser window");
    return PR_FALSE;
  }

  fakeBrowserWindow = do_QueryInterface(wrapped);
  if (fakeBrowserWindow == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to QI fake browser window");
    return PR_FALSE;
  }

  jsval readerVal;
  JS_GetProperty(cx, obj, "_dtdReader", &readerVal);
  if (readerVal == JSVAL_VOID) {
    JS_ReportError(cx, "Adblock Plus: Failed to retrieve DTD reader object");
    return PR_FALSE;
  }

  JSObject* reader = JSVAL_TO_OBJECT(readerVal);
  for (int i = 0; i < NUM_LABELS; i++) {
    JSString* str = JS_NewStringCopyZ(cx, context_labels[i]);
    if (str == nsnull) {
      JS_ReportError(cx, "Adblock Plus: Could not create JavaScript string for '%s' - out of memory?", context_labels[i]);
      return PR_FALSE;
    }

    jsval args[] = {STRING_TO_JSVAL(str)};
    jsval retval;
    if (!JS_CallFunctionName(cx, reader, "getEntity", 1, args, &retval)) {
      JS_ReportError(cx, "Adblock Plus: Failed to retrieve entity '%s' from overlay.dtd", context_labels[i]);
      return PR_FALSE;
    }

    str = JS_ValueToString(cx, retval);
    if (str == nsnull) {
      JS_ReportError(cx, "Adblock Plus: Could not convert return value of _dtdReader.getEntity() to string");
      return PR_FALSE;
    }

    strcpy_s(labelValues[i], sizeof(labelValues[i]), JS_GetStringBytes(str));
  }

  return PR_TRUE;
}
