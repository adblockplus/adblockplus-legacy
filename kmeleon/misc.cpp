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

JSBool CallModuleMethod(char* methodName, uintN argc, jsval* argv, jsval* retval, ArgsInitCallback callback, void* data)
{
  jsval localResult;
  if (!retval)
    retval = &localResult;

  nsCOMPtr<xpcIJSModuleLoader> moduleLoader = do_GetService("@mozilla.org/moz/jsloader;1");
  if (!moduleLoader)
    return JS_FALSE;

  nsresult rv;
  JSObject* globalObj;
  rv = moduleLoader->ImportInto(NS_LITERAL_CSTRING("resource:///modules/adblockplus/AppIntegrationKMeleon.jsm"), nsnull, nsnull, &globalObj);
  if (NS_FAILED(rv) || !globalObj)
    return JS_FALSE;

  abpJSContextHolder holder;
  JSContext* cx = holder.get();
  if (!cx)
    return JS_FALSE;

  if (callback && !callback(cx, globalObj, argv, data))
    return JS_FALSE;

  return JS_CallFunctionName(cx, globalObj, methodName, argc, argv, retval);
}

nsISupports* UnwrapNative(JSContext* cx, JSObject* obj) {
  nsresult rv;

  nsCOMPtr<nsIXPConnect> xpc = do_GetService(nsIXPConnect::GetCID());
  if (xpc == nsnull)
    return nsnull;

  nsCOMPtr<nsIXPConnectWrappedNative> wrapped;
  rv = xpc->GetWrappedNativeOfJSObject(cx, obj, getter_AddRefs(wrapped));
  if (NS_FAILED(rv))
    return nsnull;

  nsCOMPtr<nsISupports> native;
  rv = wrapped->GetNative(getter_AddRefs(native));
  if (NS_FAILED(rv))
    return nsnull;

  return native;
}

void OpenTab(const char* url, HWND hWnd) {
  if (kFuncs->GetKmeleonVersion() >= 0x01050000)
  {
    if (hWnd)
      kFuncs->NavigateTo(url, OPEN_NEWTAB, GetTopWindow(hWnd));
    else
      kFuncs->NavigateTo(url, OPEN_NEW, NULL);
  }
  else
    kFuncs->SendMessage("layers", PLUGIN_NAME, "AddLayersToWindow", (LONG)"1", (LONG)url);
}

void ShowContextMenu(HWND hWnd, PRBool status)
{
  jsval arg = (status ? JSVAL_TRUE : JSVAL_FALSE);
  jsval retval;
  if (CallModuleMethod("buildContextMenu", 1, &arg, &retval))
  {
    HMENU hMenu = reinterpret_cast<HMENU>(JSVAL_TO_INT(retval));

    POINT pt;
    GetCursorPos(&pt);
    TrackPopupMenu(hMenu, TPM_LEFTALIGN, pt.x, pt.y, 0, hWnd, NULL);
  }
}

WNDPROC SubclassWindow(HWND hWnd, WNDPROC newWndProc) {
  WNDPROC origProc;
  if (IsWindowUnicode(hWnd)) {
    origProc = (WNDPROC)GetWindowLongW(hWnd, GWL_WNDPROC);
    SetWindowLongW(hWnd, GWL_WNDPROC, (LONG)newWndProc);
  }
  else {
    origProc = (WNDPROC)GetWindowLongA(hWnd, GWL_WNDPROC);
    SetWindowLongA(hWnd, GWL_WNDPROC, (LONG)newWndProc);
  }
  return origProc;
}
