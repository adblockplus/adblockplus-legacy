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

  nsCOMPtr<xpcIJSModuleLoader> moduleLoader = do_GetService("@mozilla.org/moz/jsloader;1");
  if (!moduleLoader)
  {
    JS_ReportError(cx, "Adblock Plus: Failed to retrieve module loader, wrong Gecko version?");
    return PR_FALSE;
  }

  JSObject* globalObj;
  rv = moduleLoader->ImportInto(NS_LITERAL_CSTRING("resource:///modules/adblockplus/AppIntegrationKMeleon.jsm"), nsnull, nsnull, &globalObj);
  if (NS_FAILED(rv) || !globalObj)
  {
    JS_ReportError(cx, "Adblock Plus: Failed to load JavaScript module");
    return PR_FALSE;
  }

  if (!JS_DefineFunctions(cx, globalObj, module_functions))
  {
    JS_ReportError(cx, "Adblock Plus: Failed to inject native methods into JavaScript module");
    return PR_FALSE;
  }

  cmdBase = kFuncs->GetCommandIDs(NUM_COMMANDS);
  toolbarList.init(cmdBase + CMD_TOOLBAR);
  statusbarList.init(hImages, cmdBase + CMD_STATUSBAR, kFuncs->AddStatusBarIcon, kFuncs->RemoveStatusBarIcon);

  return PR_TRUE;
}
